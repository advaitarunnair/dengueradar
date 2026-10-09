"""Shared helpers: polite HTTP client with caching, config access and epi-week maths."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import time
from pathlib import Path

import requests
import yaml

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RAW = DATA / "raw"
WEB_DATA = ROOT / "web" / "public" / "data"
HTTP_CACHE = DATA / "cache" / "http"
SGT = dt.timezone(dt.timedelta(hours=8))
USER_AGENT = "DengueRadar student prototype (github.com; educational use)"

_session = requests.Session()
_session.headers["User-Agent"] = USER_AGENT
_last_request = 0.0


def load_config() -> dict:
    with open(ROOT / "config.yaml") as f:
        return yaml.safe_load(f)


def _headers(url: str) -> dict:
    key = os.environ.get("DATA_GOV_SG_API_KEY")
    if key and "data.gov.sg" in url:
        return {"x-api-key": key}
    return {}


def http_get(url: str, params: dict | None = None, *, retries: int = 5, min_interval: float = 0.3,
             timeout: int = 60, allow_404: bool = False) -> requests.Response | None:
    """GET with retry and exponential backoff. Returns None on 404 when allow_404 is set."""
    global _last_request
    delay = 2.0
    for attempt in range(retries):
        wait = min_interval - (time.time() - _last_request)
        if wait > 0:
            time.sleep(wait)
        try:
            _last_request = time.time()
            r = _session.get(url, params=params, headers=_headers(url), timeout=timeout)
            if r.status_code == 404 and allow_404:
                return None
            if r.status_code == 429 or r.status_code >= 500:
                raise requests.HTTPError(f"{r.status_code} for {r.url}")
            r.raise_for_status()
            return r
        except requests.RequestException:
            if attempt == retries - 1:
                raise
            time.sleep(delay)
            delay *= 2
    return None


def cached_json(url: str, params: dict | None = None, *, max_age_hours: float | None = None, **kw):
    """GET JSON through an on-disk cache keyed by url and params (cache dir is not committed)."""
    HTTP_CACHE.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1((url + json.dumps(params or {}, sort_keys=True)).encode()).hexdigest()
    path = HTTP_CACHE / f"{key}.json"
    if path.exists():
        age_h = (time.time() - path.stat().st_mtime) / 3600
        if max_age_hours is None or age_h < max_age_hours:
            return json.loads(path.read_text())
    data = http_get(url, params, **kw).json()
    path.write_text(json.dumps(data))
    return data


# ---- data.gov.sg helpers -------------------------------------------------

DGS_META = "https://api-production.data.gov.sg/v2/public/api/datasets"
DGS_OPEN = "https://api-open.data.gov.sg/v1/public/api/datasets"


def dgs_poll_download(dataset_id: str, *, tries: int = 10) -> bytes:
    """Resolve the poll-download URL for a data.gov.sg dataset and return the file bytes."""
    for _ in range(tries):
        body = http_get(f"{DGS_OPEN}/{dataset_id}/poll-download").json()
        url = (body.get("data") or {}).get("url")
        if url:
            return http_get(url, timeout=180).content
        time.sleep(3)
    raise RuntimeError(f"poll-download never returned a URL for {dataset_id}")


def dgs_metadata(dataset_id: str) -> dict:
    return http_get(f"{DGS_META}/{dataset_id}/metadata").json()["data"]


# ---- epi weeks (Sunday to Saturday, MMWR rule as used by MOH) -------------

def epi_week_start(year: int, week: int) -> dt.date:
    """Sunday that starts the given epi week. Week 1 is the week containing 4 January."""
    jan4 = dt.date(year, 1, 4)
    week1_sunday = jan4 - dt.timedelta(days=(jan4.weekday() + 1) % 7)
    return week1_sunday + dt.timedelta(weeks=week - 1)


def date_to_epi_week(d: dt.date) -> tuple[int, int]:
    sunday = d - dt.timedelta(days=(d.weekday() + 1) % 7)
    year = (sunday + dt.timedelta(days=3)).year  # the Wednesday decides the epi year
    return year, (sunday - epi_week_start(year, 1)).days // 7 + 1


def epi_label(year: int, week: int) -> str:
    return f"{year}-W{week:02d}"


def parse_epi_label(label: str) -> tuple[int, int]:
    y, w = label.upper().split("-W")
    return int(y), int(w)


def now_sgt() -> dt.datetime:
    return dt.datetime.now(SGT)


# ---- MSS daily station records (weather.gov.sg) ---------------------------

MSS_DIR = RAW / "mss"


def mss_download_month(station: str, year: int, month: int, url_template: str, *, refresh: bool = False) -> Path | None:
    """Download one monthly daily-records CSV to data/raw/mss. Returns None if MSS has no file."""
    MSS_DIR.mkdir(parents=True, exist_ok=True)
    path = MSS_DIR / f"DAILYDATA_{station}_{year}{month:02d}.csv"
    if path.exists() and not refresh:
        return path
    r = http_get(url_template.format(station=station, yyyymm=f"{year}{month:02d}"), allow_404=True, min_interval=0.5)
    if r is None or not r.content.lstrip(b"\xef\xbb\xbf").startswith(b"Station"):
        return None
    path.write_bytes(r.content)
    return path


def mss_read_daily(station: str):
    """All downloaded daily records for a station: DataFrame indexed by date with rain_mm, temp_c.

    Placeholder values ("—", "-", empty, mis-encoded dashes) become NaN.
    """
    import pandas as pd

    frames = []
    for path in sorted(MSS_DIR.glob(f"DAILYDATA_{station}_*.csv")):
        df = pd.read_csv(path, encoding="latin-1", header=0, dtype=str)
        cols = {c: c.lower() for c in df.columns}
        rain = next(c for c in df.columns if "daily rainfall total" in cols[c])
        temp = next(c for c in df.columns if "mean temperature" in cols[c])
        out = pd.DataFrame({
            "date": pd.to_datetime(dict(year=df["Year"].astype(int), month=df["Month"].astype(int), day=df["Day"].astype(int))),
            "rain_mm": pd.to_numeric(df[rain].str.strip(), errors="coerce"),
            "temp_c": pd.to_numeric(df[temp].str.strip(), errors="coerce"),
        })
        frames.append(out)
    if not frames:
        return pd.DataFrame(columns=["rain_mm", "temp_c"])
    return pd.concat(frames).drop_duplicates("date").set_index("date").sort_index()


# ---- weekly dengue cases ---------------------------------------------------

RECENT_CASES = DATA / "recent_cases.csv"


def fetch_nea_weekly_cases(page_url: str) -> dict[str, int]:
    """Weekly cases by epi week from the chart data embedded in NEA's Dengue Cases page.

    Only completed weeks (Saturday already past in SGT) are returned.
    """
    import re

    html = http_get(page_url, timeout=60).text
    m = re.search(r"dataSeries\s*=\s*(\[.*?\]);", html, re.S)
    if not m:
        raise RuntimeError("NEA page layout changed: dataSeries not found")
    today = now_sgt().date()
    out: dict[str, int] = {}
    for series in json.loads(m.group(1)):
        year = int(series["name"])
        for i, v in enumerate(series["data"], start=1):
            if v is None:
                continue
            if epi_week_start(year, i) + dt.timedelta(days=6) < today:
                out[epi_label(year, i)] = int(v)
    if not out:
        raise RuntimeError("NEA page returned no weekly cases")
    return out


def update_recent_cases(page_url: str) -> bool:
    """Refresh data/recent_cases.csv from NEA. Rows marked source=manual are kept for weeks NEA
    does not cover. Returns False (leaving the file untouched) if the NEA fetch fails."""
    import pandas as pd

    old = pd.read_csv(RECENT_CASES) if RECENT_CASES.exists() else pd.DataFrame(columns=["epi_week", "cases", "source"])
    if "source" not in old.columns:
        old["source"] = "manual"
    try:
        nea = fetch_nea_weekly_cases(page_url)
    except Exception as e:  # noqa: BLE001 - any failure falls back to the existing file
        print(f"WARNING: could not fetch NEA weekly cases ({e}); using existing recent_cases.csv")
        return False
    new = pd.DataFrame({"epi_week": list(nea), "cases": list(nea.values()), "source": "nea_page"})
    keep = old[~old["epi_week"].isin(new["epi_week"])]
    pd.concat([keep, new]).sort_values("epi_week").to_csv(RECENT_CASES, index=False)
    return True


def load_weekly_cases(cfg: dict):
    """Weekly dengue cases (DF + DHF) indexed by week start (Sunday).

    MOH bulletin first; weeks after its last week come from data/recent_cases.csv.
    Columns: epi_week, cases, source.
    """
    import pandas as pd

    path = RAW / "weekly_infectious_disease_bulletin.csv"
    if not path.exists():
        path.write_bytes(dgs_poll_download(cfg["datasets"]["weekly_bulletin"]["dataset_id"]))
    b = pd.read_csv(path)
    b = b[b["disease"].isin(cfg["datasets"]["weekly_bulletin"]["diseases"])]
    b = b.groupby("epi_week", as_index=False)["no._of_cases"].sum().rename(columns={"no._of_cases": "cases"})
    b["source"] = "moh_bulletin"
    frames = [b]
    if RECENT_CASES.exists():
        r = pd.read_csv(RECENT_CASES)
        if "source" not in r.columns:
            r["source"] = "manual"
        frames.append(r[r["epi_week"] > b["epi_week"].max()])
    df = pd.concat(frames, ignore_index=True)
    df["week_start"] = pd.to_datetime([epi_week_start(*parse_epi_label(w)) for w in df["epi_week"]])
    df = df.sort_values("week_start").set_index("week_start")
    df["cases"] = df["cases"].astype(float)
    return df


def weekly_weather(daily, index):
    """Aggregate daily rain_mm / temp_c to epi weeks (Sunday to Saturday) on the given index.

    A week needs at least 4 days of data; rainfall is scaled to a 7 day total.
    """
    import pandas as pd

    d = daily.copy()
    d["week_start"] = d.index - pd.to_timedelta((d.index.dayofweek + 1) % 7, unit="D")
    g = d.groupby("week_start")
    rain = g["rain_mm"].mean().where(g["rain_mm"].count() >= 4) * 7
    temp = g["temp_c"].mean().where(g["temp_c"].count() >= 4)
    return pd.DataFrame({"rain": rain, "temp": temp}).reindex(index)
