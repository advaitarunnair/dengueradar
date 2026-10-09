"""Daily station rainfall totals and mean air temperature from the data.gov.sg real-time APIs.

One small JSON file per day in data/cache/weather; only missing days are fetched.
The v1 endpoints return a whole day in one response, so they are used for bulk fetching
(1 request per day instead of about 70 paginated v2 requests). v2 is the fallback.
"""
from __future__ import annotations

import datetime as dt
import json
import time
from collections import defaultdict

import pandas as pd

from common import DATA, http_get, now_sgt

CACHE = DATA / "cache" / "weather"
KINDS = {"rain": ("rainfall", 288), "temp": ("air_temperature", 1440)}  # config key, readings per full day
MIN_COVERAGE = 0.7  # share of a day's readings a station needs for the day to count


def _fetch_v1(url: str, day: str):
    body = http_get(url, {"date": day}, timeout=180, min_interval=1.0).json()
    stations = {s["id"]: {"name": s["name"], "lat": s["location"]["latitude"], "lon": s["location"]["longitude"]}
                for s in body["metadata"]["stations"]}
    values = defaultdict(list)
    for item in body["items"]:
        for r in item["readings"]:
            if r.get("value") is not None:
                values[r["station_id"]].append(r["value"])
    return stations, values


def _fetch_v2(url: str, day: str):
    stations, values, token = {}, defaultdict(list), None
    for _ in range(200):
        params = {"date": day, **({"paginationToken": token} if token else {})}
        data = http_get(url, params, timeout=60, min_interval=0.15).json()["data"]
        for s in data["stations"]:
            stations[s["id"]] = {"name": s["name"], "lat": s["location"]["latitude"], "lon": s["location"]["longitude"]}
        for item in data["readings"]:
            for r in item["data"]:
                if r.get("value") is not None:
                    values[r["stationId"]].append(r["value"])
        token = data.get("paginationToken")
        if not token:
            break
    return stations, values


def fetch_day(cfg: dict, day: dt.date) -> dict:
    rt = cfg["datasets"]["realtime_weather"]
    out = {"date": day.isoformat(), "stations": {}, "source": {}}
    for kind, (key, _) in KINDS.items():
        try:
            stations, values = _fetch_v1(rt[f"{key}_v1"], day.isoformat())
            out["source"][kind] = "v1"
        except Exception as e:  # noqa: BLE001 - fall back to the paginated v2 endpoint
            print(f"  v1 {key} failed for {day} ({e}); trying v2")
            stations, values = _fetch_v2(rt[f"{key}_v2"], day.isoformat())
            out["source"][kind] = "v2"
        if not values:
            raise RuntimeError(f"no {key} readings returned for {day}")
        out["stations"].update(stations)
        agg = sum if kind == "rain" else (lambda v: sum(v) / len(v))
        out[kind] = {s: round(agg(v), 2) for s, v in values.items()}
        out[f"{kind}_n"] = {s: len(v) for s, v in values.items()}
    return out


def load_days(cfg: dict, n_days: int = 56, end: dt.date | None = None, fetch: bool = True):
    """Return (daily, stations). daily has one row per date and station with rain_mm and temp_c
    (NaN where the station lacked enough readings that day). `end` defaults to yesterday in SGT."""
    CACHE.mkdir(parents=True, exist_ok=True)
    end = end or (now_sgt().date() - dt.timedelta(days=1))
    rows, stations = [], {}
    for i in range(n_days):
        day = end - dt.timedelta(days=i)
        path = CACHE / f"{day.isoformat()}.json"
        if not path.exists():
            if not fetch:
                continue
            t0 = time.time()
            path.write_text(json.dumps(fetch_day(cfg, day), separators=(",", ":")))
            print(f"  fetched weather for {day} in {time.time() - t0:.0f}s")
        d = json.loads(path.read_text())
        stations.update(d["stations"])
        for sid in set(d["rain"]) | set(d["temp"]):
            rain = d["rain"].get(sid) if d["rain_n"].get(sid, 0) >= MIN_COVERAGE * KINDS["rain"][1] else None
            temp = d["temp"].get(sid) if d["temp_n"].get(sid, 0) >= MIN_COVERAGE * KINDS["temp"][1] else None
            rows.append({"date": pd.Timestamp(day), "station": sid, "rain_mm": rain, "temp_c": temp})
    for old in CACHE.glob("*.json"):  # keep the cache small
        if dt.date.fromisoformat(old.stem) < end - dt.timedelta(days=90):
            old.unlink()
    daily = pd.DataFrame(rows, columns=["date", "station", "rain_mm", "temp_c"])
    daily[["rain_mm", "temp_c"]] = daily[["rain_mm", "temp_c"]].astype(float)
    return daily, stations


if __name__ == "__main__":
    from common import load_config

    daily, stations = load_days(load_config())
    print(f"{daily['date'].nunique()} days, {len(stations)} stations, "
          f"{daily['rain_mm'].notna().sum()} rain station-days, {daily['temp_c'].notna().sum()} temp station-days")
