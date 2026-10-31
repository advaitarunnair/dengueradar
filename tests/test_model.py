import numpy as np
import pandas as pd
import pytest

from common import load_config
import lightgbm as lgb

from train_model import HORIZON, build_features, feature_names, make_dataset, predict_cases, split


@pytest.fixture
def weekly():
    rng = np.random.default_rng(0)
    idx = pd.date_range("2011-10-09", periods=600, freq="7D")  # Sundays
    return pd.DataFrame({"cases": rng.integers(20, 900, len(idx)).astype(float),
                         "rain": rng.gamma(2, 20, len(idx)), "temp": rng.normal(27.5, 1, len(idx))}, index=idx)


@pytest.mark.parametrize("pos", [60, 300, 598])
def test_no_leakage_features_ignore_the_future(weekly, pos):
    """Features for week t must not change when every value after week t is replaced."""
    before = build_features(weekly).iloc[: pos + 1]
    tampered = weekly.copy()
    rng = np.random.default_rng(1)
    tampered.iloc[pos + 1:] = rng.uniform(1e3, 1e6, size=tampered.iloc[pos + 1:].shape)
    after = build_features(tampered).iloc[: pos + 1]
    pd.testing.assert_frame_equal(before, after)


def test_features_do_change_with_current_week(weekly):
    """Sanity check that the leakage test can fail: changing week t itself changes its features."""
    tampered = weekly.copy()
    tampered.iloc[300, tampered.columns.get_loc("cases")] += 500
    assert build_features(weekly).iloc[300]["logcases_lag0"] != build_features(tampered).iloc[300]["logcases_lag0"]


def test_target_is_four_weeks_ahead(weekly):
    d = make_dataset(weekly)
    t = d.index[100]
    assert d.loc[t, "actual"] == weekly.loc[t + pd.Timedelta(weeks=HORIZON), "cases"]
    assert d.loc[t, "persistence"] == weekly.loc[t, "cases"]
    assert d.loc[t, "seasonal"] == weekly.loc[t + pd.Timedelta(weeks=HORIZON - 52), "cases"]


def test_split_is_time_ordered_without_overlap(weekly):
    cfg = load_config()
    fit, val, test = split(make_dataset(weekly), cfg)
    assert len(val) == cfg["forecast"]["validation_weeks"]
    assert fit["target_week"].max() < val["target_week"].min()
    assert val["target_week"].max() < test["target_week"].min()
    assert set(fit.index).isdisjoint(val.index) and set(val.index).isdisjoint(test.index)
    assert (pd.concat([fit, val])["target_year"] <= cfg["forecast"]["train_end_year"]).all()
    assert (test["target_year"] > cfg["forecast"]["train_end_year"]).all()
    # every training feature row is observed before the first test target week
    assert val.index.max() < test["target_week"].min()


def test_blend_mixes_model_and_persistence(weekly):
    d = make_dataset(weekly).dropna(subset=feature_names())
    X = d[feature_names()]
    booster = lgb.train(dict(objective="regression", verbose=-1, seed=1), lgb.Dataset(X, d["actual"]), num_boost_round=3)
    bundle = {"model_str": booster.model_to_string(), "features": feature_names(), "target_mode": "delta"}
    full = predict_cases(bundle, X)
    half = predict_cases({**bundle, "blend_alpha": 0.5}, X)
    persistence = np.expm1(X["logcases_lag0"].to_numpy())
    assert np.allclose(half, np.clip(0.5 * full + 0.5 * persistence, 0, None))
    assert np.allclose(predict_cases({**bundle, "blend_alpha": 0.0}, X), persistence)
