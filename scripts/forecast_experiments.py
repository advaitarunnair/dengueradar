"""Honest forecast comparison: ratio target, blends with persistence, and a "trend continues" baseline.

Same features and split as train_model.py: train on target weeks 2012-W08 to 2019-W52, test on 2020-W01 to
2026-W39. Hyperparameters and blend weights are chosen on the last 52 training weeks only, never on the test set.
Writes every method into model_eval.json and forecast_test.json. The production model only changes if a variant
beats persistence on test MAE, and that is reported either way.
"""
from __future__ import annotations

import itertools
import json

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd

from common import WEB_DATA, load_config, load_weekly_cases, mss_read_daily, now_sgt
from train_model import HORIZON, MODEL_PATH, _xy, build_weekly, feature_label, feature_names, make_dataset, metrics, predict_cases, split

TEST_END = "2026-W39"  # keep the published test window fixed so results stay comparable
ALPHAS = [round(a, 2) for a in np.arange(0, 1.01, 0.05)]


def fit_mode(fit: pd.DataFrame, val: pd.DataFrame, mode: str) -> tuple[dict, dict]:
    """Small validation-only grid for one target mode. Returns the fit-only bundle and the winning settings."""
    best = None
    for leaves, min_leaf in itertools.product([4, 8, 15], [10, 20]):
        params = dict(objective="regression", learning_rate=0.03, num_leaves=leaves, min_data_in_leaf=min_leaf,
                      feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0,
                      seed=42, verbose=-1, deterministic=True, force_row_wise=True)
        Xf, yf = _xy(fit, mode)
        Xv, yv = _xy(val, mode)
        booster = lgb.train(params, lgb.Dataset(Xf, yf), num_boost_round=2000, valid_sets=[lgb.Dataset(Xv, yv)],
                            callbacks=[lgb.early_stopping(100, verbose=False)])
        bundle = {"model_str": booster.model_to_string(num_iteration=booster.best_iteration), "features": feature_names(), "target_mode": mode}
        mae = float(np.abs(val["actual"] - predict_cases(bundle, val)).mean())
        if best is None or mae < best["val_mae"]:
            best = {"val_mae": mae, "params": params, "rounds": max(int(booster.best_iteration), 20), "mode": mode, "num_leaves": leaves, "min_data_in_leaf": min_leaf, "bundle": bundle}
    return best["bundle"], best


def refit(d: pd.DataFrame, best: dict) -> dict:
    X, y = _xy(d, best["mode"])
    booster = lgb.train(best["params"], lgb.Dataset(X, y), num_boost_round=best["rounds"])
    return {"model_str": booster.model_to_string(), "features": feature_names(), "target_mode": best["mode"]}


def best_alpha(val: pd.DataFrame, pred: np.ndarray) -> float:
    return min(ALPHAS, key=lambda a: float(np.abs(val["actual"] - (a * pred + (1 - a) * val["persistence"])).mean()))


def direction_only(actual, called, current) -> dict:
    a, c, s = map(np.asarray, (actual, current, called))
    ok = (a != c) & (s != 0)
    return {"n": int(len(a)), "mae": None, "mape": None, "direction_accuracy": float((s[ok] == np.sign(a - c)[ok]).mean())}


def main() -> None:
    cfg = load_config()
    cases = load_weekly_cases(cfg)
    weekly = build_weekly(cfg, cases, mss_read_daily(cfg["datasets"]["mss_daily"]["station"]))
    d = make_dataset(weekly)
    d = d[d[["rain_sum_2_8", "temp_mean_2_8"]].notna().all(axis=1)]
    fit, val, test = split(d, cfg)
    test = test[test["target_epi_week"] <= TEST_END].copy()
    full = pd.concat([fit, val])

    bundles, settings = {}, {}
    for name, mode in (("model", "level"), ("ratio", "delta")):
        val_bundle, best = fit_mode(fit, val, mode)
        settings[name] = {k: best[k] for k in ("mode", "num_leaves", "min_data_in_leaf", "rounds", "val_mae")}
        settings[name]["alpha"] = best_alpha(val, predict_cases(val_bundle, val))
        bundles[name] = refit(full, best)

    p = {name: predict_cases(b, test) for name, b in bundles.items()}
    series = {
        "model": p["model"], "ratio": p["ratio"],
        "blend_level": settings["model"]["alpha"] * p["model"] + (1 - settings["model"]["alpha"]) * test["persistence"].to_numpy(),
        "blend_ratio": settings["ratio"]["alpha"] * p["ratio"] + (1 - settings["ratio"]["alpha"]) * test["persistence"].to_numpy(),
        "persistence": test["persistence"].to_numpy(), "seasonal": test["seasonal"].to_numpy(dtype=float),
    }
    # "Trend continues": same direction as the last 4-week change in cases.
    trend = np.sign(test["persistence"].to_numpy() - weekly["cases"].shift(HORIZON).reindex(test.index).to_numpy())

    threshold = float(np.percentile(full["actual"], 75))
    table = {}
    for scope, mask in (("all_test_weeks", np.ones(len(test), bool)), ("outbreak_weeks", test["actual"].to_numpy() > threshold)):
        part = test[mask]
        table[scope] = {k: metrics(part["actual"], v[mask], part["current"]) for k, v in series.items()}
        table[scope]["trend"] = direction_only(part["actual"], trend[mask], part["current"])

    all_ = table["all_test_weeks"]
    persistence_mae = all_["persistence"]["mae"]
    beaters = [k for k in ("model", "ratio", "blend_level", "blend_ratio") if all_[k]["mae"] < persistence_mae]
    # Among any that beat persistence on the test set, choose by validation error, not test error.
    val_mae = {
        "model": settings["model"]["val_mae"], "ratio": settings["ratio"]["val_mae"],
        "blend_level": float(np.abs(val["actual"] - (settings["model"]["alpha"] * predict_cases(fit_mode(fit, val, "level")[0], val) + (1 - settings["model"]["alpha"]) * val["persistence"])).mean()),
        "blend_ratio": float(np.abs(val["actual"] - (settings["ratio"]["alpha"] * predict_cases(fit_mode(fit, val, "delta")[0], val) + (1 - settings["ratio"]["alpha"]) * val["persistence"])).mean()),
    }
    adopted = min(beaters, key=lambda k: val_mae[k]) if beaters else None

    names = {"model": "LightGBM (current production)", "ratio": "LightGBM, ratio target", "blend_level": "Blend: LightGBM + persistence",
             "blend_ratio": "Blend: ratio + persistence", "persistence": "Persistence", "seasonal": "Seasonal naive", "trend": "Trend continues (direction only)"}
    for scope, rows in table.items():
        extra = f" (actual > {threshold:.0f})" if scope == "outbreak_weeks" else ""
        print(f"\n{scope}{extra}, n={rows['persistence']['n']}\n{'':38}{'MAE':>8}{'MAPE %':>9}{'Direction':>11}")
        for k, m in rows.items():
            mae = "n/a" if m["mae"] is None else f"{m['mae']:.1f}"
            mape = "n/a" if m["mape"] is None else f"{m['mape']:.1f}"
            da = "n/a" if m["direction_accuracy"] is None else f"{m['direction_accuracy']:.1%}"
            print(f"{names[k]:38}{mae:>8}{mape:>9}{da:>11}")
    print(f"\nBlend weights chosen on validation: LightGBM alpha={settings['model']['alpha']}, ratio alpha={settings['ratio']['alpha']}")
    print(f"Beat persistence on test MAE: {beaters or 'none'}; adopted: {adopted or 'none, production forecast unchanged'}")

    ev = json.loads((WEB_DATA / "model_eval.json").read_text())
    ev["metrics"] = table
    ev["method_names"] = names
    ev["experiments"] = {"generated_at": now_sgt().isoformat(timespec="seconds"), "settings": settings, "beat_persistence_on_test_mae": beaters,
                         "adopted": adopted, "selection": "Hyperparameters and blend weights chosen on the last 52 training weeks only."}
    ev["test"] = {"first_target_week": test["target_epi_week"].iloc[0], "last_target_week": test["target_epi_week"].iloc[-1], "n_weeks": len(test)}
    ev["outbreak_threshold_cases"] = round(threshold)
    (WEB_DATA / "model_eval.json").write_text(json.dumps(ev, indent=1))
    rows = []
    for i, r in enumerate(test.itertuples()):
        rows.append({"epi_week": r.target_epi_week, "actual": int(r.actual), "model": round(float(p["model"][i]), 1), "ratio": round(float(p["ratio"][i]), 1),
                     "blend": round(float(series["blend_ratio"][i]), 1), "persistence": int(r.persistence), "seasonal": None if pd.isna(r.seasonal) else int(r.seasonal)})
    (WEB_DATA / "forecast_test.json").write_text(json.dumps(rows))

    if adopted:
        base = "model" if adopted in ("model", "blend_level") else "ratio"
        bundle = {**bundles[base], "horizon_weeks": HORIZON, "trained_at": now_sgt().isoformat(timespec="seconds"), "train_target_weeks": [full["target_epi_week"].iloc[0], full["target_epi_week"].iloc[-1]]}
        if adopted.startswith("blend"):
            bundle["blend_alpha"] = settings[base]["alpha"]
        joblib.dump(bundle, MODEL_PATH)
        print(f"Saved {adopted} to {MODEL_PATH.name}")
        booster = lgb.Booster(model_str=bundle["model_str"])
        gain = pd.Series(booster.feature_importance("gain"), index=bundle["features"])
        gain = gain.groupby(gain.index.map(feature_label)).sum().sort_values(ascending=False)
        top = [{"label": k, "importance": round(float(v / gain.sum()), 4)} for k, v in gain.head(10).items()]
        (WEB_DATA / "feature_importance.json").write_text(json.dumps(top, indent=1))


if __name__ == "__main__":
    main()
