"""Run once: train and honestly evaluate the 4-week-ahead island-wide dengue forecast."""
from __future__ import annotations

import itertools
import json

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd

from common import (ROOT, WEB_DATA, date_to_epi_week, epi_label, load_config, load_weekly_cases,
                    mss_download_month, mss_read_daily, now_sgt, update_recent_cases, weekly_weather)

HORIZON = 4
CASE_LAGS = range(0, 4)
WEATHER_LAGS = range(2, 9)
MODEL_PATH = ROOT / "models" / "forecast.joblib"


def feature_names() -> list[str]:
    names = [f"logcases_lag{k}" for k in CASE_LAGS] + ["logcases_mean4", "logcases_slope4"]
    names += [f"rain_lag{k}" for k in WEATHER_LAGS] + [f"temp_lag{k}" for k in WEATHER_LAGS]
    return names + ["rain_sum_2_8", "temp_mean_2_8", "week_sin", "week_cos"]


def feature_label(name: str) -> str:
    """Plain-English label for a feature."""
    if name.startswith("logcases_lag"):
        k = int(name[-1])
        return "Cases this week" if k == 0 else f"Cases {k} week{'s' if k > 1 else ''} ago"
    if name.startswith(("rain_lag", "temp_lag")):
        kind = "Rainfall" if name.startswith("rain") else "Mean temperature"
        return f"{kind} {name.split('lag')[1]} weeks ago"
    return {
        "logcases_mean4": "Average cases over the last 4 weeks",
        "logcases_slope4": "Trend in cases over the last 4 weeks",
        "rain_sum_2_8": "Total rainfall 2 to 8 weeks ago",
        "temp_mean_2_8": "Mean temperature 2 to 8 weeks ago",
        "week_sin": "Time of year (seasonality)",
        "week_cos": "Time of year (seasonality)",
    }[name]


def build_features(weekly: pd.DataFrame) -> pd.DataFrame:
    """Features for every week t using only rows at or before t.

    `weekly` is indexed by week start with columns cases, rain, temp on a gap-free weekly index.
    Every column is built from non-negative shifts only, so nothing after week t can leak in.
    """
    lc = np.log1p(weekly["cases"])
    f = pd.DataFrame(index=weekly.index)
    for k in CASE_LAGS:
        f[f"logcases_lag{k}"] = lc.shift(k)
    lags = np.column_stack([lc.shift(k) for k in (3, 2, 1, 0)])  # oldest to newest
    f["logcases_mean4"] = lags.mean(axis=1)
    x = np.arange(4) - 1.5
    f["logcases_slope4"] = (lags * x).sum(axis=1) / (x ** 2).sum()
    for k in WEATHER_LAGS:
        f[f"rain_lag{k}"] = weekly["rain"].shift(k)
    for k in WEATHER_LAGS:
        f[f"temp_lag{k}"] = weekly["temp"].shift(k)
    f["rain_sum_2_8"] = f[[f"rain_lag{k}" for k in WEATHER_LAGS]].mean(axis=1) * len(WEATHER_LAGS)
    f["temp_mean_2_8"] = f[[f"temp_lag{k}" for k in WEATHER_LAGS]].mean(axis=1)
    woy = np.array([date_to_epi_week(d.date())[1] for d in weekly.index])
    f["week_sin"] = np.sin(2 * np.pi * woy / 52.18)
    f["week_cos"] = np.cos(2 * np.pi * woy / 52.18)
    return f[feature_names()]


def build_weekly(cfg: dict, cases: pd.DataFrame, daily: pd.DataFrame) -> pd.DataFrame:
    """Gap-free weekly frame of cases, rain, temp from 8+ weeks before the first case week."""
    idx = pd.date_range(cases.index.min() - pd.Timedelta(weeks=12), cases.index.max(), freq="7D")
    weekly = weekly_weather(daily, idx)
    weekly["cases"] = cases["cases"].reindex(idx)
    return weekly


def make_dataset(weekly: pd.DataFrame) -> pd.DataFrame:
    """Feature rows plus target and baselines, one row per origin week t with a known target."""
    f = build_features(weekly)
    d = f.copy()
    d["current"] = weekly["cases"]
    d["actual"] = weekly["cases"].shift(-HORIZON)
    d["target_week"] = d.index + pd.Timedelta(weeks=HORIZON)
    d["target_year"] = [date_to_epi_week(t.date())[0] for t in d["target_week"]]
    d["target_epi_week"] = [epi_label(*date_to_epi_week(t.date())) for t in d["target_week"]]
    d["persistence"] = d["current"]
    d["seasonal"] = weekly["cases"].shift(52 - HORIZON)  # cases 52 weeks before the target week
    case_cols = [c for c in feature_names() if c.startswith("logcases")]
    return d.dropna(subset=case_cols + ["actual"])


def split(d: pd.DataFrame, cfg: dict) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Time-based split on the target week: fit / validation (last 52 training weeks) / test."""
    train_all = d[d["target_year"] <= cfg["forecast"]["train_end_year"]]
    test = d[d["target_year"] > cfg["forecast"]["train_end_year"]]
    n_val = cfg["forecast"]["validation_weeks"]
    return train_all.iloc[:-n_val], train_all.iloc[-n_val:], test


def _xy(d: pd.DataFrame, mode: str):
    y = np.log1p(d["actual"])
    return d[feature_names()], (y - d["logcases_lag0"] if mode == "delta" else y)


def predict_cases(bundle: dict, X: pd.DataFrame) -> np.ndarray:
    """Predicted weekly cases 4 weeks ahead from a saved model bundle."""
    booster = lgb.Booster(model_str=bundle["model_str"])
    raw = booster.predict(X[bundle["features"]])
    if bundle["target_mode"] == "delta":
        raw = raw + X["logcases_lag0"].to_numpy()
    return np.clip(np.expm1(raw), 0, None)


def metrics(actual, pred, current) -> dict:
    actual, pred, current = map(np.asarray, (actual, pred, current))
    ok = ~np.isnan(pred)
    a, p, c = actual[ok], pred[ok], current[ok]
    moved = a != c
    called = np.sign(p - c)[moved]
    direction = None if not (p != c).any() else float((called == np.sign(a - c)[moved]).mean())
    return {"n": int(ok.sum()), "mae": float(np.abs(a - p).mean()),
            "mape": float((np.abs(a - p) / np.maximum(a, 1)).mean() * 100), "direction_accuracy": direction}


def train(cfg: dict, d: pd.DataFrame) -> tuple[dict, dict]:
    fit, val, _ = split(d, cfg)
    grid = itertools.product(["level", "delta"], [4, 8, 15], [10, 20])
    results = []
    for mode, leaves, min_leaf in grid:
        params = dict(objective="regression", learning_rate=0.03, num_leaves=leaves, min_data_in_leaf=min_leaf,
                      feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0,
                      seed=42, verbose=-1, deterministic=True, force_row_wise=True)
        Xf, yf = _xy(fit, mode)
        Xv, yv = _xy(val, mode)
        booster = lgb.train(params, lgb.Dataset(Xf, yf), num_boost_round=2000,
                            valid_sets=[lgb.Dataset(Xv, yv)], callbacks=[lgb.early_stopping(100, verbose=False)])
        bundle = {"model_str": booster.model_to_string(num_iteration=booster.best_iteration),
                  "features": feature_names(), "target_mode": mode}
        val_mae = float(np.abs(val["actual"] - predict_cases(bundle, val)).mean())
        results.append({"target_mode": mode, "num_leaves": leaves, "min_data_in_leaf": min_leaf,
                        "best_iteration": int(booster.best_iteration), "val_mae": val_mae, "params": params})
    best = min(results, key=lambda r: r["val_mae"])
    # Refit on fit + validation with the chosen settings and number of rounds.
    full = pd.concat([fit, val])
    X, y = _xy(full, best["target_mode"])
    booster = lgb.train(best["params"], lgb.Dataset(X, y), num_boost_round=max(best["best_iteration"], 20))
    bundle = {"model_str": booster.model_to_string(), "features": feature_names(),
              "target_mode": best["target_mode"], "horizon_weeks": HORIZON,
              "trained_at": now_sgt().isoformat(timespec="seconds"),
              "train_target_weeks": [full["target_epi_week"].iloc[0], full["target_epi_week"].iloc[-1]]}
    tuning = {"selected": {k: best[k] for k in ("target_mode", "num_leaves", "min_data_in_leaf", "best_iteration", "val_mae")},
              "candidates": [{k: r[k] for k in ("target_mode", "num_leaves", "min_data_in_leaf", "best_iteration", "val_mae")} for r in results]}
    return bundle, tuning


def ensure_mss(cfg: dict, first: pd.Timestamp, last: pd.Timestamp) -> list[str]:
    m = cfg["datasets"]["mss_daily"]
    start = (first - pd.DateOffset(months=3)).to_period("M")
    missing = []
    for p in pd.period_range(start, last.to_period("M"), freq="M"):
        if mss_download_month(m["station"], p.year, p.month, m["url_template"]) is None:
            missing.append(str(p))
    return missing


def main() -> None:
    cfg = load_config()
    nea_ok = update_recent_cases(cfg["datasets"]["nea_weekly_cases"]["page"])
    cases = load_weekly_cases(cfg)
    bulletin = cases[cases["source"] == "moh_bulletin"]
    print(f"MOH bulletin covers {bulletin['epi_week'].iloc[0]} to {bulletin['epi_week'].iloc[-1]} ({len(bulletin)} weeks).")
    lag_weeks = (pd.Timestamp(now_sgt().date()) - bulletin.index[-1]).days // 7
    if lag_weeks > 8:
        print(f"NOTE: the bulletin ends {lag_weeks} weeks before today. Later weeks come from "
              f"data/recent_cases.csv ({'refreshed from the NEA page' if nea_ok else 'NEA fetch FAILED, file as is'}).")
    print(f"Case series used: {cases['epi_week'].iloc[0]} to {cases['epi_week'].iloc[-1]} "
          f"({cases['source'].value_counts().to_dict()})")
    gaps = pd.date_range(cases.index.min(), cases.index.max(), freq="7D").difference(cases.index)
    assert len(gaps) == 0, f"missing case weeks: {list(gaps)[:5]}"

    missing = ensure_mss(cfg, cases.index.min(), cases.index.max())
    print(f"MSS Changi months not available: {missing or 'none'}")
    daily = mss_read_daily(cfg["datasets"]["mss_daily"]["station"])
    weekly = build_weekly(cfg, cases, daily)
    d = make_dataset(weekly)
    d = d[d[["rain_sum_2_8", "temp_mean_2_8"]].notna().all(axis=1)]  # weeks with real weather history only
    fit, val, test = split(d, cfg)
    assert fit["target_week"].max() < val["target_week"].min() <= val["target_week"].max() < test["target_week"].min()

    bundle, tuning = train(cfg, d)
    MODEL_PATH.parent.mkdir(exist_ok=True)
    joblib.dump(bundle, MODEL_PATH)

    test = test.copy()
    test["model"] = predict_cases(bundle, test)
    threshold = float(np.percentile(pd.concat([fit, val])["actual"], 75))
    outbreak = test[test["actual"] > threshold]
    table = {}
    for scope, part in (("all_test_weeks", test), ("outbreak_weeks", outbreak)):
        table[scope] = {name: metrics(part["actual"], part[name], part["current"])
                        for name in ("model", "persistence", "seasonal")}

    print(f"\nSelected: {tuning['selected']}")
    print(f"Train target weeks {fit['target_epi_week'].iloc[0]} to {val['target_epi_week'].iloc[-1]} "
          f"(n={len(fit) + len(val)}, last {len(val)} used for validation); "
          f"test {test['target_epi_week'].iloc[0]} to {test['target_epi_week'].iloc[-1]} (n={len(test)})")
    for scope, rows in table.items():
        extra = f" (actual > {threshold:.0f} cases, the 75th percentile of training weeks)" if scope == "outbreak_weeks" else ""
        print(f"\n{scope}{extra}\n{'':14}{'n':>5}{'MAE':>9}{'MAPE %':>9}{'Direction':>11}")
        for name, m in rows.items():
            da = "n/a" if m["direction_accuracy"] is None else f"{m['direction_accuracy']:.1%}"
            print(f"{name:14}{m['n']:>5}{m['mae']:>9.1f}{m['mape']:>9.1f}{da:>11}")

    booster = lgb.Booster(model_str=bundle["model_str"])
    gain = pd.Series(booster.feature_importance("gain"), index=bundle["features"])
    gain = gain.groupby(gain.index.map(feature_label)).sum().sort_values(ascending=False)
    top = [{"label": k, "importance": round(float(v / gain.sum()), 4)} for k, v in gain.head(10).items()]

    WEB_DATA.mkdir(parents=True, exist_ok=True)
    (WEB_DATA / "model_eval.json").write_text(json.dumps({
        "generated_at": now_sgt().isoformat(timespec="seconds"),
        "horizon_weeks": HORIZON,
        "algorithm": "LightGBM gradient boosted trees",
        "target": "log1p(weekly dengue cases) 4 weeks ahead"
                  + (" (the model learns the change from this week, then adds it back)" if bundle["target_mode"] == "delta" else ""),
        "train": {"first_target_week": fit["target_epi_week"].iloc[0], "last_target_week": val["target_epi_week"].iloc[-1],
                  "n_weeks": len(fit) + len(val), "validation_weeks": len(val)},
        "test": {"first_target_week": test["target_epi_week"].iloc[0], "last_target_week": test["target_epi_week"].iloc[-1],
                 "n_weeks": len(test)},
        "outbreak_threshold_cases": round(threshold),
        "case_sources": {"moh_bulletin": [bulletin["epi_week"].iloc[0], bulletin["epi_week"].iloc[-1]],
                         "nea_page": [cases[cases["source"] != "moh_bulletin"]["epi_week"].min(),
                                      cases["epi_week"].iloc[-1]] if (cases["source"] != "moh_bulletin").any() else None},
        "metrics": table, "tuning": tuning,
        "features": [{"name": n, "label": feature_label(n)} for n in bundle["features"]],
    }, indent=1))
    (WEB_DATA / "forecast_test.json").write_text(json.dumps([
        {"epi_week": r.target_epi_week, "actual": int(r.actual), "model": round(float(r.model), 1),
         "persistence": int(r.persistence), "seasonal": None if pd.isna(r.seasonal) else int(r.seasonal)}
        for r in test.itertuples()]))
    (WEB_DATA / "feature_importance.json").write_text(json.dumps(top, indent=1))
    print("\nTop features by gain:", ", ".join(f"{t['label']} ({t['importance']:.0%})" for t in top[:5]))
    print(f"Wrote {MODEL_PATH.name}, model_eval.json, forecast_test.json, feature_importance.json")


if __name__ == "__main__":
    main()
