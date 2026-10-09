# DengueRadar

Student hackathon prototype (not an official NEA tool). A static site that ranks Singapore subzones for
dengue inspection each week, with an island-wide LightGBM forecast of weekly cases 4 weeks ahead.

## Layout
- `scripts/common.py` HTTP client (cache, retry, backoff), data.gov.sg helpers, epi weeks, case and weather loaders
- `scripts/download_static.py` run once: subzone boundaries + SingStat population -> `data/subzone_population.csv`, `web/public/data/subzones.geojson`
- `scripts/train_model.py` run once: train + evaluate -> `models/forecast.joblib`, `web/public/data/{model_eval,forecast_test,feature_importance}.json`
- `scripts/build_scores.py` weekly job -> `web/public/data/{scores.geojson,clusters.geojson,meta.json}`, `data/history/YYYY-WW.json`
- `web/` React + Vite + TypeScript + Tailwind, HashRouter, base `/dengueradar/`; reads everything from `web/public/data`
- `config.yaml` verified dataset IDs/URLs, scoring weights, thresholds

## Commands
```
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/download_static.py
.venv/bin/python scripts/train_model.py
.venv/bin/python scripts/build_scores.py
.venv/bin/pytest -q
cd web && npm install && npm run dev      # npm run build to type-check and bundle
```
On macOS without Homebrew libomp, LightGBM needs `DYLD_FALLBACK_LIBRARY_PATH=$HOME/.local/lib` (a copy of
scikit-learn's bundled libomp.dylib lives there on the original dev machine).

## Conventions and rules
- Never ship fabricated or simulated data. If a source fails, the job must fail loudly, not invent values.
- No leakage: `build_features` may only use shifts >= 0. `tests/test_model.py` enforces this.
- Evaluation is time-based and always reported next to persistence and seasonal-naive baselines.
- Dataset IDs/URLs go in `config.yaml` only after being confirmed through the API.
- Epi weeks are Sunday to Saturday (MMWR rule, matches MOH). Week keys look like `2026-W39`.
- Distances use SVY21 (EPSG:3414); stored geometry is WGS84.
- `models/forecast.joblib` is a dict holding the LightGBM model as text, so it loads on any Python version.

## Data notes (verified 2026-10-09)
- MOH bulletin on data.gov.sg ends at 2022-W52. Weeks from 2023 come from the chart data on NEA's Dengue
  Cases page, saved in `data/recent_cases.csv` (source `nea_page`; rows with source `manual` are hand-entered).
- MSS monthly files lag by a month or two; recent Changi weather comes from the real-time API (station S24).
- Population: SingStat Table Builder C020123 (General Household Survey 2025), all 332 subzones match.
