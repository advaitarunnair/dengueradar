"""Early check of the rule-based ranking: did new dengue clusters appear in subzones we flagged the week before?

A cluster counts as new when its centre is more than 500 m from every cluster seen before (clusters grow and
get renamed, so names are not reliable). For each new cluster we look up the subzone containing its centre
and that subzone's band in the latest weekly snapshot taken before the cluster's epi week.
The sample is tiny for now and the page says so.
"""
from __future__ import annotations

import datetime as dt
import json
import subprocess
import sys

import geopandas as gpd

from common import DATA, ROOT, WEB_DATA, date_to_epi_week, epi_label, load_config

LOG = DATA / "history" / "cluster_log.json"
NEW_IF_FURTHER_THAN_M = 500


def _subzones(cfg: dict) -> gpd.GeoDataFrame:
    z = gpd.read_file(WEB_DATA / "subzones.geojson")[["subzone_id", "geometry"]]
    return z.to_crs(cfg["crs_metric"])


def update_log(clusters: gpd.GeoDataFrame, seen_on: dt.date, cfg: dict) -> list[dict]:
    """Append clusters not seen before to data/history/cluster_log.json. Returns the new entries."""
    log = json.loads(LOG.read_text()) if LOG.exists() else []
    if clusters.empty:
        return []
    pts = clusters.to_crs(cfg["crs_metric"]).copy()
    pts["geometry"] = pts.geometry.centroid
    known = gpd.GeoSeries(gpd.points_from_xy([e["x"] for e in log], [e["y"] for e in log]), crs=cfg["crs_metric"]) if log else None
    zones = _subzones(cfg)
    added = []
    for _, c in pts.iterrows():
        if known is not None and known.distance(c.geometry).min() <= NEW_IF_FURTHER_THAN_M:
            continue
        hit = zones[zones.contains(c.geometry)]
        entry = {"first_seen": seen_on.isoformat(), "epi_week": epi_label(*date_to_epi_week(seen_on)),
                 "locality": c["locality"], "cases": int(c["cases"]), "x": round(c.geometry.x, 1), "y": round(c.geometry.y, 1),
                 "subzone_id": hit["subzone_id"].iloc[0] if len(hit) else None}
        log.append(entry)
        added.append(entry)
        known = gpd.GeoSeries(gpd.points_from_xy([e["x"] for e in log], [e["y"] for e in log]), crs=cfg["crs_metric"])
    LOG.write_text(json.dumps(log, indent=1))
    return added


def write_check() -> dict:
    """Summarise the log against weekly snapshots into web/public/data/ranking_check.json."""
    log = json.loads(LOG.read_text()) if LOG.exists() else []
    snaps = {p.stem.replace("-", "-W"): json.loads(p.read_text()) for p in sorted((DATA / "history").glob("20*-*.json"))}
    first_week = min(snaps) if snaps else None
    rows = []
    for e in log:
        prior = [w for w in snaps if w < e["epi_week"]]
        if not prior or e["subzone_id"] is None or e["first_seen"] == log[0]["first_seen"]:
            continue  # the very first day's clusters are a baseline, not "new"
        band = snaps[max(prior)]["subzones"].get(e["subzone_id"], {}).get("band")
        rows.append({**{k: e[k] for k in ("first_seen", "locality", "cases", "subzone_id")}, "snapshot_week": max(prior), "band_week_before": band})
    out = {
        "new_clusters": len(rows),
        "in_high_prior_week": sum(r["band_week_before"] == "High" for r in rows),
        "in_high_or_elevated_prior_week": sum(r["band_week_before"] in ("High", "Elevated") for r in rows),
        "weeks": [first_week] if first_week else [],
        "since": log[0]["first_seen"] if log else None,
        "clusters": rows,
        "note": "New = cluster centre more than 500 m from every earlier cluster. Band = the subzone's band in the last weekly snapshot before the cluster appeared.",
    }
    (WEB_DATA / "ranking_check.json").write_text(json.dumps(out, indent=1))
    return out


def backfill_from_git(cfg: dict) -> None:
    """Rebuild the log from every committed version of clusters.geojson (run once, locally)."""
    LOG.unlink(missing_ok=True)
    revs = subprocess.run(["git", "log", "--reverse", "--format=%h %cs", "--", "web/public/data/clusters.geojson"],
                          cwd=ROOT, capture_output=True, text=True, check=True).stdout.split("\n")
    for line in filter(None, revs):
        sha, day = line.split()
        raw = subprocess.run(["git", "show", f"{sha}:web/public/data/clusters.geojson"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
        g = gpd.GeoDataFrame.from_features(json.loads(raw)["features"], crs=4326)
        update_log(g, dt.date.fromisoformat(day), cfg)


if __name__ == "__main__":
    cfg = load_config()
    if "--backfill-from-git" in sys.argv:
        backfill_from_git(cfg)
    print(json.dumps({k: v for k, v in write_check().items() if k != "clusters"}, indent=1))
