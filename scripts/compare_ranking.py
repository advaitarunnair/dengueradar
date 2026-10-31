"""Print the top 20 subzones under the old and the new ranking for the current week.

Uses the published scores, clusters and meta in web/public/data, so it needs no network and no model calls.
"""
from __future__ import annotations

import json

import geopandas as gpd
import pandas as pd

from build_scores import load_subzones, score_subzones, spread_components
from common import WEB_DATA, load_config

WATCH = ["TAMAN JURONG", "FERNVALE", "TOA PAYOH CENTRAL", "BISHAN EAST", "MARYMOUNT"]


def scored(cfg: dict, ranking: dict) -> pd.DataFrame:
    meta = json.loads((WEB_DATA / "meta.json").read_text())
    scores = gpd.read_file(WEB_DATA / "scores.geojson")
    clusters = gpd.read_file(WEB_DATA / "clusters.geojson")
    subzones = load_subzones(cfg)
    df = subzones.merge(scores[["subzone_id", "rain_mm", "temp_c"]], on="subzone_id")
    spread = spread_components(df, clusters, cfg)
    df = pd.concat([df, spread], axis=1)
    return score_subzones(df, cfg["scoring"]["weights"], meta["outlook"], cfg, ranking)


def show(title: str, s: pd.DataFrame) -> None:
    el = s[s["eligible"]].sort_values("rank")
    print(f"\n{title}\n{'rank':>4}  {'subzone':<24}{'band':<10}{'risk':>6}{'priority':>10}{'seniors+children':>18}{'largest cluster <=1km':>23}")
    for _, r in el.head(20).iterrows():
        mark = " <--" if r["subzone"] in WATCH else ""
        print(f"{int(r['rank']):>4}  {r['subzone']:<24}{r['band']:<10}{r['risk']:>6.2f}{r['priority']:>10.1f}{int(r['vulnerable']):>18,}{int(r['max_cluster_cases_near']):>23}{mark}")


def main() -> None:
    cfg = load_config()
    old, new = scored(cfg, cfg["ranking_old"]), scored(cfg, cfg["ranking"])
    show("OLD: percentile pressure, priority = risk x population", old)
    show("NEW: log pressure, cluster override, priority = risk^2 x population^0.5, band first", new)
    print("\nWatched subzones (old -> new)")
    for name in WATCH:
        a, b = old[old["subzone"] == name].iloc[0], new[new["subzone"] == name].iloc[0]
        print(f"  {name:<20} #{int(a['rank'])} {a['band']:<9} -> #{int(b['rank'])} {b['band']}")
    el = new[new["eligible"]]
    print(f"\nBands (new): {el['band'].value_counts().to_dict()}; overrides: {int(el['cluster_override'].sum())}")


if __name__ == "__main__":
    main()
