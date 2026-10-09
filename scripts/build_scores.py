"""Weekly job: fetch clusters, cases and weather, forecast, score subzones, write site data."""
from __future__ import annotations

import datetime as dt
import json
import math
import re

import geopandas as gpd
import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd

import realtime_weather
from common import (DATA, RAW, WEB_DATA, date_to_epi_week, dgs_metadata, dgs_poll_download, epi_label,
                    load_config, load_weekly_cases, mss_download_month, mss_read_daily, now_sgt,
                    update_recent_cases)
from train_model import HORIZON, MODEL_PATH, build_features, build_weekly, feature_label, predict_cases

HISTORY = DATA / "history"
COMPONENTS = ("spread", "rain", "temp")


# ---- inputs ----------------------------------------------------------------

def load_clusters(cfg: dict) -> gpd.GeoDataFrame:
    """Current active dengue clusters (polygon, locality, case count)."""
    ds = cfg["datasets"]["dengue_clusters"]
    raw = dgs_poll_download(ds["dataset_id"])
    (RAW / "dengue_clusters.geojson").write_bytes(raw)
    gdf = gpd.read_file(RAW / "dengue_clusters.geojson")
    if len(gdf) and "CASE_SIZE" not in gdf.columns:  # older exports keep attributes in an HTML table
        props = gdf["Description"].map(lambda h: dict(re.findall(r"<th>(.*?)</th>\s*<td>(.*?)</td>", h or "")))
        gdf["LOCALITY"] = props.map(lambda p: p.get("LOCALITY"))
        gdf["CASE_SIZE"] = props.map(lambda p: p.get("CASE_SIZE"))
    out = gpd.GeoDataFrame({"locality": gdf.get("LOCALITY", pd.Series(dtype=str)),
                            "cases": pd.to_numeric(gdf.get("CASE_SIZE", pd.Series(dtype=float)), errors="coerce")},
                           geometry=gdf.geometry.force_2d() if len(gdf) else [], crs=4326)
    out = out[out["cases"].notna() & ~out.geometry.is_empty].reset_index(drop=True)
    out["cases"] = out["cases"].astype(int)
    out.attrs["last_updated"] = dgs_metadata(ds["dataset_id"]).get("lastUpdatedAt")
    return out


def load_subzones(cfg: dict) -> gpd.GeoDataFrame:
    """Simplified web geometry joined with population (written by download_static.py)."""
    gdf = gpd.read_file(WEB_DATA / "subzones.geojson")
    full = gpd.read_file(RAW / "subzones.geojson").to_crs(cfg["crs_metric"])
    key = (full["PLN_AREA_N"] + "|" + full["SUBZONE_N"])
    centroids = dict(zip(key, full.geometry.centroid))
    gdf["centroid"] = [centroids[f"{p}|{s}"] for p, s in zip(gdf["planning_area"], gdf["subzone"])]
    return gdf


def changi_daily(cfg: dict, realtime: pd.DataFrame) -> tuple[pd.DataFrame, str]:
    """Changi daily rain and temperature: MSS records, then real-time station readings for later days."""
    m = cfg["datasets"]["mss_daily"]
    today = now_sgt().date()
    for back in range(4):  # MSS publishes with a lag: re-check the latest months
        p = (pd.Timestamp(today) - pd.DateOffset(months=back)).to_period("M")
        mss_download_month(m["station"], p.year, p.month, m["url_template"], refresh=back <= 1)
    mss = mss_read_daily(m["station"])
    rt = realtime[realtime["station"] == m["station"]].set_index("date")[["rain_mm", "temp_c"]].sort_index()
    extra = rt[rt.index > mss.index.max()]
    source = "MSS daily records" + (f" to {mss.index.max():%d %b %Y}, then real-time station {m['station']}" if len(extra) else "")
    return pd.concat([mss, extra]), source


# ---- forecast --------------------------------------------------------------

def outlook_label(pct_change: float, threshold: float) -> str:
    if pct_change >= threshold:
        return "Rising"
    if pct_change <= -threshold:
        return "Falling"
    return "Stable"


def describe_feature(name: str, row: pd.Series) -> str:
    v = row[name]
    if name.startswith("logcases_lag") or name == "logcases_mean4":
        return f"{math.expm1(v):,.0f} cases"
    if name == "logcases_slope4":
        return f"{(math.exp(v) - 1) * 100:+.0f}% per week"
    if name.startswith("rain"):
        return f"{v:,.0f} mm"
    if name.startswith("temp"):
        return f"{v:.1f} °C"
    return ""


def make_forecast(cfg: dict, cases: pd.DataFrame, daily: pd.DataFrame) -> dict:
    bundle = joblib.load(MODEL_PATH)
    weekly = build_weekly(cfg, cases, daily)
    feats = build_features(weekly)
    row = feats.iloc[[-1]]
    weather_cols = [c for c in feats.columns if c.startswith(("rain_lag", "temp_lag"))]
    missing = [c for c in weather_cols if pd.isna(row[c].iloc[0])]
    if len(missing) > 4:
        raise RuntimeError(f"too little recent Changi weather to forecast honestly; missing {missing}")
    current = float(weekly["cases"].iloc[-1])
    pred = float(predict_cases(bundle, row)[0])
    pct = pred / current - 1 if current > 0 else 0.0

    booster = lgb.Booster(model_str=bundle["model_str"])
    contrib = booster.predict(row[bundle["features"]], pred_contrib=True)[0][:-1]
    c = pd.DataFrame({"name": bundle["features"], "contribution": contrib})
    c["label"] = c["name"].map(feature_label)
    grouped = c.groupby("label")["contribution"].sum()
    top = grouped.reindex(grouped.abs().sort_values(ascending=False).index).head(3)
    drivers = []
    for label, value in top.items():
        lead = c[c["label"] == label].sort_values("contribution", key=abs, ascending=False)["name"].iloc[0]
        detail = "" if label.startswith("Time of year") else describe_feature(lead, row.iloc[0])
        direction = "up" if value > 0 else "down"
        drivers.append({"label": label, "value": detail, "direction": direction,
                        "contribution": round(float(value), 4),
                        "text": f"{label}{f' ({detail})' if detail else ''} pushes the forecast {direction}, compared with a typical week"})
    case_year, case_week = date_to_epi_week(weekly.index[-1].date())
    target = weekly.index[-1] + pd.Timedelta(weeks=HORIZON)
    return {"case_week": epi_label(case_year, case_week), "target_week": epi_label(*date_to_epi_week(target.date())),
            "current_cases": int(current), "forecast_cases": int(round(pred)), "pct_change": round(pct * 100, 1),
            "outlook": outlook_label(pct, cfg["forecast"]["outlook_threshold"]), "drivers": drivers,
            "weather_features_missing": len(missing)}


# ---- subzone scoring -------------------------------------------------------

def spread_components(subzones: gpd.GeoDataFrame, clusters: gpd.GeoDataFrame, cfg: dict) -> pd.DataFrame:
    """Distance-decayed cluster pressure at each subzone centroid, plus the numbers behind the reason text."""
    geoms = list(clusters.to_crs(cfg["crs_metric"]).geometry)
    cases = clusters["cases"].to_numpy(dtype=float)
    rows = []
    for centroid in subzones["centroid"]:
        d_km = np.array([centroid.distance(g) / 1000 for g in geoms]) if geoms else np.array([])
        near = d_km <= 1.0
        rows.append({
            "spread_raw": float((cases * np.exp(-d_km / cfg["scoring"]["decay_km"])).sum()) if geoms else 0.0,
            "clusters_within_1km": int(near.sum()), "cluster_cases_within_1km": int(cases[near].sum()) if geoms else 0,
            "nearest_cluster_km": round(float(d_km.min()), 2) if geoms else None,
        })
    return pd.DataFrame(rows, index=subzones.index)


def station_values(daily: pd.DataFrame, stations: dict, end: dt.date, cfg: dict) -> pd.DataFrame:
    """Per station: rainfall total over day -56..-14 and mean temperature over the last 28 days.
    A station needs data on at least 80% of the days in a window, otherwise it has no value."""
    far, near = cfg["scoring"]["rain_window_days"]
    end = pd.Timestamp(end)
    rain_days = pd.date_range(end - pd.Timedelta(days=far - 1), end - pd.Timedelta(days=near - 1))
    temp_days = pd.date_range(end - pd.Timedelta(days=cfg["scoring"]["temp_window_days"] - 1), end)
    r = daily[daily["date"].isin(rain_days)].groupby("station")["rain_mm"].agg(["mean", "count"])
    t = daily[daily["date"].isin(temp_days)].groupby("station")["temp_c"].agg(["mean", "count"])
    out = pd.DataFrame(index=sorted(stations))
    out["rain_mm"] = (r["mean"] * len(rain_days)).where(r["count"] >= 0.8 * len(rain_days))
    out["temp_c"] = t["mean"].where(t["count"] >= 0.8 * len(temp_days))
    pts = gpd.GeoSeries(gpd.points_from_xy([stations[s]["lon"] for s in out.index],
                                           [stations[s]["lat"] for s in out.index]), crs=4326).to_crs(cfg["crs_metric"])
    out["x"], out["y"] = pts.x.to_numpy(), pts.y.to_numpy()
    out["name"] = [stations[s]["name"] for s in out.index]
    return out


def nearest_station_value(subzones: gpd.GeoDataFrame, st: pd.DataFrame, col: str) -> pd.DataFrame:
    """Value at the nearest station that has data (stations without data are skipped)."""
    valid = st[st[col].notna()]
    if valid.empty:
        raise RuntimeError(f"no station has enough {col} data")
    xy = valid[["x", "y"]].to_numpy()
    rows = []
    for c in subzones["centroid"]:
        i = int(np.argmin(np.hypot(xy[:, 0] - c.x, xy[:, 1] - c.y)))
        rows.append({col: round(float(valid[col].iloc[i]), 1), f"{col}_station": f"{valid['name'].iloc[i]} ({valid.index[i]})"})
    return pd.DataFrame(rows, index=subzones.index)


def percentile_rank(values: pd.Series) -> pd.Series:
    """0 to 1 rank across the given values (ties share the lower rank)."""
    if len(values) <= 1:
        return pd.Series(0.0, index=values.index)
    return (values.rank(method="min") - 1) / (len(values) - 1)


def score_subzones(df: pd.DataFrame, weights: dict, outlook: str, cfg: dict) -> pd.DataFrame:
    """Pure, deterministic scoring. `df` needs subzone_id, residents, vulnerable, spread_raw, rain_mm, temp_c.

    Subzones under the resident minimum are excluded (band None). The frontend re-implements the
    risk, band and priority steps for the weight sliders, using the stored percentile components.
    """
    out = df.copy()
    out["eligible"] = out["residents"] >= cfg["scoring"]["min_residents"]
    el = out[out["eligible"]]
    for comp, raw in zip(COMPONENTS, ("spread_raw", "rain_mm", "temp_c")):
        out[comp] = percentile_rank(el[raw]).round(4)
    total = sum(weights[c] for c in COMPONENTS)
    out["risk"] = sum(weights[c] / total * out[c] for c in COMPONENTS).round(4)
    out["priority"] = (out["risk"] * out["vulnerable"]).round(1)

    el = out[out["eligible"]]
    n = len(el)
    bands = cfg["scoring"]["bands"][outlook]
    n_high = int(bands["high"] * n + 0.5)  # half-up, same as Math.round in the browser
    n_elev = int(bands["elevated"] * n + 0.5)
    by_risk = el.sort_values(["risk", "subzone_id"], ascending=[False, True]).index
    out["risk_rank"] = pd.Series(range(1, n + 1), index=by_risk)
    out["band"] = None
    out.loc[by_risk, "band"] = ["High"] * n_high + ["Elevated"] * n_elev + ["Low"] * (n - n_high - n_elev)
    by_priority = el.sort_values(["priority", "subzone_id"], ascending=[False, True]).index
    out["rank"] = pd.Series(range(1, n + 1), index=by_priority)
    for col in ("risk_rank", "rank"):
        out[col] = out[col].astype("Int64")
    return out


def top_share(p: float) -> str:
    """'top 20%' style wording for a 0 to 1 percentile."""
    if p >= 0.5:
        return f"in the top {max(10, math.ceil((1 - p) * 10) * 10)}% island-wide"
    return "in the lower half island-wide"


def reason(r: pd.Series) -> str:
    parts = []
    if r["clusters_within_1km"] > 0:
        n, c = r["clusters_within_1km"], r["cluster_cases_within_1km"]
        parts.append(f"{n} active cluster{'s' if n != 1 else ''} within 1 km ({c} case{'s' if c != 1 else ''})")
    elif r["nearest_cluster_km"] is not None and not pd.isna(r["nearest_cluster_km"]):
        parts.append(f"nearest active cluster {r['nearest_cluster_km']:.1f} km away")
    else:
        parts.append("no active clusters island-wide")
    parts.append(f"rainfall 2 to 8 weeks ago ({r['rain_mm']:,.0f} mm) {top_share(r['rain'])}")
    if r["temp"] >= 0.8:
        parts.append(f"temperature over the last 4 weeks ({r['temp_c']:.1f} °C) {top_share(r['temp'])}")
    parts.append(f"{int(r['vulnerable']):,} seniors and children")
    return "; ".join(parts)


def week_on_week(scored: pd.DataFrame, week: str) -> tuple[pd.DataFrame, str | None]:
    """rank_change (positive = moved up the list) and is_new_in_top20 against the previous snapshot."""
    out = scored.copy()
    previous = sorted(p for p in HISTORY.glob("*.json") if p.stem < week.replace("-W", "-"))
    out["rank_change"] = None
    out["is_new_in_top20"] = False
    if not previous:
        return out, None
    prev = json.loads(previous[-1].read_text())
    prev_rank = {k: v["rank"] for k, v in prev["subzones"].items() if v.get("rank") is not None}
    for i, r in out[out["eligible"]].iterrows():
        before = prev_rank.get(r["subzone_id"])
        out.at[i, "rank_change"] = None if before is None else int(before - r["rank"])
        out.at[i, "is_new_in_top20"] = bool(r["rank"] <= 20 and (before is None or before > 20))
    return out, prev["epi_week"]


# ---- outputs ---------------------------------------------------------------

def _clean(v):
    if v is pd.NA:
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        return None if math.isnan(v) else float(v)
    if isinstance(v, np.bool_):
        return bool(v)
    return v


SCORE_PROPS = ["subzone_id", "subzone", "planning_area", "region", "residents", "age65plus", "under15", "vulnerable",
               "eligible", "spread", "rain", "temp", "spread_raw", "rain_mm", "temp_c", "rain_mm_station",
               "temp_c_station", "clusters_within_1km", "cluster_cases_within_1km", "nearest_cluster_km",
               "risk", "priority", "band", "risk_rank", "rank", "rank_change", "is_new_in_top20", "reason"]


def to_feature_collection(gdf: gpd.GeoDataFrame, props: list[str]) -> dict:
    feats = []
    for _, r in gdf.iterrows():
        feats.append({"type": "Feature", "properties": {p: _clean(r[p]) for p in props},
                      "geometry": json.loads(gpd.GeoSeries([r.geometry]).to_json())["features"][0]["geometry"]})
    return {"type": "FeatureCollection", "features": feats}


def sources(cfg: dict) -> list[dict]:
    licence = "Singapore Open Data Licence"
    d = cfg["datasets"]
    return [
        {"name": d["dengue_clusters"]["name"], "agency": d["dengue_clusters"]["agency"], "url": d["dengue_clusters"]["page"], "licence": licence},
        {"name": d["weekly_bulletin"]["name"], "agency": d["weekly_bulletin"]["agency"], "url": d["weekly_bulletin"]["page"], "licence": licence},
        {"name": d["nea_weekly_cases"]["name"], "agency": d["nea_weekly_cases"]["agency"], "url": d["nea_weekly_cases"]["page"], "licence": "NEA website terms of use"},
        {"name": d["realtime_weather"]["name"], "agency": d["realtime_weather"]["agency"], "url": d["realtime_weather"]["page"], "licence": licence},
        {"name": d["mss_daily"]["name"] + f" ({d['mss_daily']['station_name']})", "agency": d["mss_daily"]["agency"], "url": d["mss_daily"]["page"], "licence": "Meteorological Service Singapore terms of use"},
        {"name": d["subzone_boundaries"]["name"], "agency": d["subzone_boundaries"]["agency"], "url": d["subzone_boundaries"]["page"], "licence": licence},
        {"name": d["population"]["name"], "agency": d["population"]["agency"], "url": d["population"]["page"], "licence": licence},
    ]


def main() -> None:
    cfg = load_config()
    now = now_sgt()
    week = epi_label(*date_to_epi_week(now.date()))
    weather_end = now.date() - dt.timedelta(days=1)
    print(f"DengueRadar weekly build for {week} ({now:%Y-%m-%d %H:%M} SGT)")

    clusters = load_clusters(cfg)
    print(f"Active clusters: {len(clusters)} ({clusters['cases'].sum()} cases)")
    if clusters.empty:
        print("WARNING: no active clusters in the dataset; the spread component is zero everywhere.")

    nea_ok = update_recent_cases(cfg["datasets"]["nea_weekly_cases"]["page"])
    cases = load_weekly_cases(cfg)
    stale_weeks = (pd.Timestamp(now.date()) - cases.index[-1]).days // 7 - 1
    if stale_weeks > 2:
        raise RuntimeError(f"latest case week is {cases['epi_week'].iloc[-1]}, {stale_weeks} weeks behind. "
                           "Add recent weeks to data/recent_cases.csv (epi_week,cases,source=manual).")
    last_weeks = cases.iloc[-(max(8, HORIZON)):]
    manual_used = bool((last_weeks["source"] == "manual").any())

    realtime, stations = realtime_weather.load_days(cfg, 56, weather_end)
    print(f"Real-time weather: {realtime['date'].nunique()} days, {len(stations)} stations")
    daily, changi_source = changi_daily(cfg, realtime)
    forecast = make_forecast(cfg, cases, daily)
    print(f"Forecast: {forecast['current_cases']} cases in {forecast['case_week']} -> {forecast['forecast_cases']} in "
          f"{forecast['target_week']} ({forecast['pct_change']:+.1f}%), outlook {forecast['outlook']}")

    subzones = load_subzones(cfg)
    st = station_values(realtime, stations, weather_end, cfg)
    df = pd.concat([subzones, spread_components(subzones, clusters, cfg),
                    nearest_station_value(subzones, st, "rain_mm"), nearest_station_value(subzones, st, "temp_c")], axis=1)
    scored = score_subzones(df, cfg["scoring"]["weights"], forecast["outlook"], cfg)
    scored["reason"] = [reason(r) if r["eligible"] else "Fewer than 100 residents: not ranked" for _, r in scored.iterrows()]
    scored, previous_week = week_on_week(scored, week)
    scored = gpd.GeoDataFrame(scored, geometry="geometry", crs=4326)

    WEB_DATA.mkdir(parents=True, exist_ok=True)
    (WEB_DATA / "scores.geojson").write_text(json.dumps(to_feature_collection(scored, SCORE_PROPS), separators=(",", ":")))
    (WEB_DATA / "clusters.geojson").write_text(json.dumps(to_feature_collection(clusters, ["locality", "cases"]), separators=(",", ":")))
    eligible = scored[scored["eligible"]]
    meta = {
        "generated_at": now.isoformat(timespec="seconds"), "epi_week": week,
        "current_cases": forecast["current_cases"], "case_week": forecast["case_week"],
        "forecast_cases": forecast["forecast_cases"], "forecast_week": forecast["target_week"],
        "pct_change": forecast["pct_change"], "outlook": forecast["outlook"], "drivers": forecast["drivers"],
        "outlook_threshold_pct": cfg["forecast"]["outlook_threshold"] * 100,
        "active_clusters": int(len(clusters)), "cluster_cases": int(clusters["cases"].sum()),
        "clusters_updated_at": clusters.attrs.get("last_updated"),
        "population_reference_year": cfg["datasets"]["population"]["reference_year"],
        "case_data": {"last_week": forecast["case_week"], "bulletin_last_week": cases[cases["source"] == "moh_bulletin"]["epi_week"].iloc[-1],
                      "recent_source": str(cases["source"].iloc[-1]), "nea_fetch_ok": nea_ok, "manual_topup_used": manual_used},
        "weather": {"window_end": weather_end.isoformat(), "rain_stations_with_data": int(st["rain_mm"].notna().sum()),
                    "temp_stations_with_data": int(st["temp_c"].notna().sum()), "changi_source": changi_source,
                    "forecast_weather_features_missing": forecast["weather_features_missing"]},
        "scoring": {"weights": cfg["scoring"]["weights"], "bands": cfg["scoring"]["bands"],
                    "min_residents": cfg["scoring"]["min_residents"], "decay_km": cfg["scoring"]["decay_km"],
                    "eligible_subzones": int(len(eligible)), "total_subzones": int(len(scored))},
        "previous_week": previous_week,
        "sources": sources(cfg),
    }
    (WEB_DATA / "meta.json").write_text(json.dumps(meta, indent=1))

    HISTORY.mkdir(parents=True, exist_ok=True)
    snapshot = {"epi_week": week, "generated_at": meta["generated_at"], "outlook": forecast["outlook"],
                "current_cases": forecast["current_cases"], "forecast_cases": forecast["forecast_cases"],
                "subzones": {r["subzone_id"]: {"rank": int(r["rank"]), "band": r["band"], "risk": float(r["risk"]),
                                               "priority": float(r["priority"])} for _, r in eligible.iterrows()}}
    (HISTORY / f"{week.replace('-W', '-')}.json").write_text(json.dumps(snapshot, separators=(",", ":")))

    print(f"\nBands: {eligible['band'].value_counts().to_dict()} of {len(eligible)} eligible subzones")
    print("Top 10 by priority:")
    for _, r in eligible.sort_values("rank").head(10).iterrows():
        print(f"{int(r['rank']):>3}. {r['subzone']:<24} {r['planning_area']:<16} {r['band']:<9} risk {r['risk']:.2f}  {r['reason']}")


if __name__ == "__main__":
    main()
