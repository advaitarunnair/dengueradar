"""Run once: download subzone boundaries and resident population, join them, write web geometry."""
from __future__ import annotations

import json
import re

import geopandas as gpd
import pandas as pd
import shapely

from common import DATA, RAW, WEB_DATA, dgs_poll_download, http_get, load_config

CFG = load_config()
SENIOR = ["65 - 69", "70 - 74", "75 - 79", "80 - 84", "85 - 89", "90 & Over"]
CHILD = ["0 - 4", "5 - 9", "10-14"]


def norm(name: str) -> str:
    """Normalise a place name so boundary and population names join."""
    s = name.upper().strip()
    s = s.replace("&", " AND ").replace("'", "").replace("’", "")
    s = re.sub(r"[^A-Z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def parse_description(html: str) -> dict:
    """Older exports hold attributes in an HTML table inside a Description field."""
    return dict(re.findall(r"<th>(.*?)</th>\s*<td>(.*?)</td>", html or ""))


def load_boundaries() -> gpd.GeoDataFrame:
    path = RAW / "subzones.geojson"
    if not path.exists():
        path.write_bytes(dgs_poll_download(CFG["datasets"]["subzone_boundaries"]["dataset_id"]))
    gdf = gpd.read_file(path)
    if "SUBZONE_N" not in gdf.columns:
        props = gdf["Description"].map(parse_description).apply(pd.Series)
        gdf = gdf.join(props[["SUBZONE_N", "PLN_AREA_N", "REGION_N"]])
    gdf = gdf.rename(columns={"SUBZONE_N": "subzone", "PLN_AREA_N": "planning_area", "REGION_N": "region"})
    gdf = gdf[["subzone", "planning_area", "region", "geometry"]].copy()
    gdf["geometry"] = gdf.geometry.force_2d()
    return gdf.set_crs(4326, allow_override=True)


def load_population() -> pd.DataFrame:
    path = RAW / "singstat_C020123.json"
    if not path.exists():
        r = http_get(CFG["datasets"]["population"]["api"], {"limit": 5000}, timeout=120)
        path.write_bytes(r.content)
    rows = json.loads(path.read_text())["Data"]["row"]
    areas = {r["rowNo"]: r["rowText"].replace(" - Total", "") for r in rows if "." not in r["rowNo"]}

    def num(v: str) -> int:
        return 0 if v.strip() in ("-", "", "na") else int(float(v))

    out = []
    for r in rows:
        if "." not in r["rowNo"]:
            continue
        total = {c["key"]: num(c["value"]) for c in next(g for g in r["columns"] if g["key"] == "Total")["columns"]}
        out.append({
            "pop_subzone": r["rowText"], "pop_planning_area": areas[r["rowNo"].split(".")[0]],
            "residents": total["Total"], "age65plus": sum(total[k] for k in SENIOR),
            "under15": sum(total[k] for k in CHILD),
        })
    return pd.DataFrame(out)


def main() -> None:
    gdf = load_boundaries()
    pop = load_population()
    gdf["key"] = gdf["planning_area"].map(norm) + "|" + gdf["subzone"].map(norm)
    pop["key"] = pop["pop_planning_area"].map(norm) + "|" + pop["pop_subzone"].map(norm)
    assert gdf["key"].is_unique and pop["key"].is_unique

    merged = gdf.merge(pop, on="key", how="left", indicator=True)
    unmatched_pop = pop[~pop["key"].isin(gdf["key"])]
    no_pop = merged[merged["_merge"] == "left_only"]
    total = pop["residents"].sum()
    print(f"Boundaries: {len(gdf)} subzones. Population rows: {len(pop)} (reference year "
          f"{CFG['datasets']['population']['reference_year']}, {total:,} residents).")
    print(f"Population rows with no boundary: {len(unmatched_pop)} "
          f"({unmatched_pop['residents'].sum():,} residents, {unmatched_pop['residents'].sum() / total:.2%})")
    if len(unmatched_pop):
        print(unmatched_pop[["pop_planning_area", "pop_subzone", "residents"]].to_string(index=False))
    print(f"Boundaries with no population row (treated as 0 residents): {len(no_pop)}")
    if len(no_pop):
        print("  " + ", ".join(sorted(no_pop["subzone"])))
    assert unmatched_pop["residents"].sum() / total < 0.02, "more than 2% of residents unmatched"

    for c in ("residents", "age65plus", "under15"):
        merged[c] = merged[c].fillna(0).astype(int)
    merged["vulnerable"] = merged["age65plus"] + merged["under15"]
    merged["subzone_id"] = merged["key"].str.replace(r"[| ]+", "-", regex=True).str.lower()
    cols = ["subzone_id", "subzone", "planning_area", "region", "residents", "age65plus", "under15", "vulnerable"]
    merged[cols].sort_values("subzone_id").to_csv(DATA / "subzone_population.csv", index=False)

    # Topology-preserving simplification in SVY21 metres (shared borders stay shared).
    metric = merged.to_crs(CFG["crs_metric"])
    metric["geometry"] = shapely.make_valid(metric.geometry.values)
    simple = shapely.coverage_simplify(metric.geometry.values, tolerance=12)
    web = gpd.GeoDataFrame(merged[cols], geometry=simple, crs=CFG["crs_metric"]).to_crs(4326)
    web["geometry"] = shapely.set_precision(web.geometry.values, 0.00001)
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    out = WEB_DATA / "subzones.geojson"
    out.write_text(web.to_json(drop_id=True))
    print(f"Wrote {out} ({out.stat().st_size / 1e6:.2f} MB), data/subzone_population.csv")
    assert out.stat().st_size < 1.5e6


if __name__ == "__main__":
    main()
