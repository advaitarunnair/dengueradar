import json

import numpy as np
import pandas as pd
import pytest

import datetime as dt

from build_scores import (SCORE_PROPS, driver_text, nearest_station_value, outlook_label, percentile_rank,
                          score_subzones, station_values)
from common import WEB_DATA, load_config

CFG = load_config()
W = CFG["scoring"]["weights"]


@pytest.fixture
def inputs():
    rng = np.random.default_rng(7)
    n = 210
    df = pd.DataFrame({"subzone_id": [f"z{i:03d}" for i in range(n)],
                       "residents": rng.integers(0, 40000, n), "vulnerable": rng.integers(0, 12000, n),
                       "spread_raw": rng.gamma(1, 2, n), "rain_mm": rng.gamma(4, 60, n), "temp_c": rng.normal(28, 0.6, n)})
    df.loc[:9, "residents"] = 50  # below the 100 resident minimum
    return df


def test_scoring_is_deterministic(inputs):
    a = score_subzones(inputs, W, "Stable", CFG)
    b = score_subzones(inputs.sample(frac=1, random_state=1), W, "Stable", CFG).sort_index()
    pd.testing.assert_frame_equal(a, b)


@pytest.mark.parametrize("outlook", ["Rising", "Stable", "Falling"])
def test_bands_respect_outlook_thresholds(inputs, outlook):
    s = score_subzones(inputs, W, outlook, CFG)
    el = s[s["eligible"]]
    n = len(el)
    share = CFG["scoring"]["bands"][outlook]
    counts = el["band"].value_counts()
    assert counts["High"] == int(share["high"] * n + 0.5)
    assert counts["Elevated"] == int(share["elevated"] * n + 0.5)
    assert counts.sum() == n
    # bands follow risk order: every High is at least as risky as every Elevated, and so on
    assert el[el.band == "High"]["risk"].min() >= el[el.band == "Elevated"]["risk"].max()
    assert el[el.band == "Elevated"]["risk"].min() >= el[el.band == "Low"]["risk"].max()


def test_rising_flags_more_high_than_stable(inputs):
    high = lambda o: (score_subzones(inputs, W, o, CFG)["band"] == "High").sum()  # noqa: E731
    assert high("Rising") == 2 * high("Stable") == 2 * high("Falling")


def test_small_subzones_are_excluded(inputs):
    s = score_subzones(inputs, W, "Rising", CFG)
    small = s[s["residents"] < CFG["scoring"]["min_residents"]]
    assert len(small) >= 10 and small["band"].isna().all() and small["rank"].isna().all()


def test_risk_and_priority_formula(inputs):
    s = score_subzones(inputs, W, "Stable", CFG)
    el = s[s["eligible"]]
    assert el[["spread", "rain", "temp"]].min().min() == 0 and el[["spread", "rain", "temp"]].max().max() == 1
    expected = W["spread"] * el["spread"] + W["rain"] * el["rain"] + W["temp"] * el["temp"]
    assert np.allclose(el["risk"], expected, atol=1e-4)
    assert np.allclose(el["priority"], el["risk"] * el["vulnerable"], atol=0.051)
    assert sorted(el["rank"]) == list(range(1, len(el) + 1))


def test_percentile_rank_bounds():
    p = percentile_rank(pd.Series([5.0, 1.0, 3.0, 3.0]))
    assert p.tolist() == [1.0, 0.0, pytest.approx(1 / 3), pytest.approx(1 / 3)]


def test_outlook_label_thresholds():
    assert outlook_label(0.15, 0.15) == "Rising"
    assert outlook_label(0.149, 0.15) == "Stable"
    assert outlook_label(-0.149, 0.15) == "Stable"
    assert outlook_label(-0.15, 0.15) == "Falling"


def test_output_schema_matches_frontend():
    """The files the site fetches must carry the fields declared in web/src/types.ts."""
    scores_path = WEB_DATA / "scores.geojson"
    if not scores_path.exists():
        pytest.skip("build_scores.py has not been run yet")
    scores = json.loads(scores_path.read_text())
    assert scores["type"] == "FeatureCollection" and len(scores["features"]) > 300
    for f in scores["features"]:
        p = f["properties"]
        assert set(p) == set(SCORE_PROPS)
        assert f["geometry"]["type"] in ("Polygon", "MultiPolygon")
        if p["eligible"]:
            assert p["band"] in ("High", "Elevated", "Low")
            assert all(0 <= p[c] <= 1 for c in ("spread", "rain", "temp", "risk"))
            assert isinstance(p["rank"], int) and isinstance(p["reason"], str) and p["reason"]
        else:
            assert p["band"] is None and p["rank"] is None
    meta = json.loads((WEB_DATA / "meta.json").read_text())
    for key in ("generated_at", "epi_week", "current_cases", "forecast_cases", "pct_change", "outlook", "drivers",
                "active_clusters", "population_reference_year", "sources", "case_data", "scoring", "clusters", "weather"):
        assert key in meta
    assert meta["outlook"] in ("Rising", "Stable", "Falling")
    assert len(meta["drivers"]) == 3 and all({"label", "direction", "text"} <= set(d) for d in meta["drivers"])
    assert {"last_week", "manual_topup_used"} <= set(meta["case_data"])
    assert {"source", "source_name", "source_url", "updated_at", "fallback_used", "note"} <= set(meta["clusters"])
    assert meta["clusters"]["fallback_used"] == (meta["clusters"]["note"] is not None)
    assert {"rain_stations_skipped", "rain_max_missing_share", "rain_window_days"} <= set(meta["weather"])
    assert all({"id", "name", "missing_days"} <= set(s) for s in meta["weather"]["rain_stations_skipped"])
    clusters = json.loads((WEB_DATA / "clusters.geojson").read_text())
    assert all({"locality", "cases"} <= set(f["properties"]) for f in clusters["features"])


def test_driver_text_is_relative_to_typical():
    import math
    low = driver_text("Cases this week", "logcases_lag0", math.log1p(71), math.log1p(250), -0.5)
    assert low == "Cases this week (71) are below typical levels, pulling the forecast down"
    high = driver_text("Rainfall 5 weeks ago", "rain_lag5", 120.0, 40.0, 0.2)
    assert high == "Rainfall 5 weeks ago (120 mm) is above typical levels, pushing the forecast up"
    assert driver_text("Time of year (seasonality)", "week_sin", 0.1, 0.0, 0.1) == "The time of year is pushing the forecast up"


def test_rain_station_with_gaps_is_skipped_for_next_nearest():
    """A station missing more than 10% of the rain window is not used, even if it is the nearest."""
    from shapely.geometry import Point
    import geopandas as gpd

    end = dt.date(2026, 10, 8)
    days = pd.date_range(end - dt.timedelta(days=55), end)
    stations = {"NEAR": {"name": "Near", "lat": 1.35, "lon": 103.80}, "FAR": {"name": "Far", "lat": 1.35, "lon": 103.90},
                "OK": {"name": "Ok", "lat": 1.40, "lon": 103.80}}
    rows = []
    for i, d in enumerate(days):
        rows.append({"date": d, "station": "FAR", "rain_mm": 2.0, "temp_c": 28.0})
        rows.append({"date": d, "station": "OK", "rain_mm": 1.0 if i != 5 else None, "temp_c": 28.0})   # 1 day missing: fine
        rows.append({"date": d, "station": "NEAR", "rain_mm": 9.0 if i % 5 else None, "temp_c": 28.0})  # about 20% missing
    st = station_values(pd.DataFrame(rows), stations, end, CFG)
    n = st["rain_window_days"].iloc[0]
    assert n == 43 and pd.isna(st.loc["NEAR", "rain_mm"]) and st.loc["NEAR", "rain_missing_days"] > 0.1 * n
    assert st.loc["FAR", "rain_mm"] == pytest.approx(2.0 * n) and st.loc["OK", "rain_missing_days"] == 1
    assert st.loc["OK", "rain_mm"] == pytest.approx(1.0 * n)
    centroid = gpd.GeoSeries([Point(103.80, 1.35)], crs=4326).to_crs(CFG["crs_metric"]).iloc[0]
    got = nearest_station_value(pd.DataFrame({"centroid": [centroid]}), st, "rain_mm")
    assert got["rain_mm_station"].iloc[0] == "Ok (OK)"
