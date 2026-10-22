"""Generate clearly labelled DEMO premises and inspection history for the Copilot (db/demo_seed.json).

Premises are fictional ("Demo Blk 214, Serangoon Garden") but placed at random points inside the real
subzone boundaries. Nothing here feeds the forecast or the risk ranking, which stay on real data.
"""
from __future__ import annotations

import datetime as dt
import json
import random

import geopandas as gpd
from shapely.geometry import Point

from common import ROOT, WEB_DATA, date_to_epi_week, epi_label

random.seed(20261022)
TODAY = dt.date(2026, 10, 21)  # history runs up to this date; regenerate to move it
WEEKS = 8

TYPES = [  # type, weight, label, breeding probability per visit, layout notes options
    ("hdb_block", 46, "Blk", 0.10, ["12-storey block with void deck, 2 bin chutes and rooftop water tanks",
                                    "16-storey block with void deck, scupper drains along the corridor and a bamboo-pole holder on each unit",
                                    "25-storey block with multi-storey car park next door and roof gutters over the lift lobby"]),
    ("landed_home", 16, "Landed Row", 0.16, ["Row of terrace houses with roof gutters, potted plants and gully traps",
                                             "Semi-detached houses with garden ponds, ornamental containers and a covered car porch"]),
    ("condo", 10, "Condo", 0.08, ["Condominium with swimming pool, landscaped garden and basement car park",
                                  "Condominium with sky gardens, planter boxes and roof-level water features"]),
    ("construction_site", 9, "Worksite", 0.30, ["Building site with floor slabs, lift wells, stacked pails and plastic sheeting",
                                                "Road and drainage works with open trenches, barriers and ponding on the ground"]),
    ("school", 7, "School", 0.07, ["Primary school with field, eco-garden, canopy roof gutters and a bin centre"]),
    ("market", 6, "Market & Food Centre", 0.12, ["Wet market and hawker centre with drains, crates, bin centre and loading bay"]),
    ("park", 6, "Park", 0.09, ["Neighbourhood park with playground, tree holes, drains and a shelter with roof gutters"]),
]
HABITATS = {
    "hdb_block": ["flower pot plate", "pail", "bamboo pole holder", "scupper drain", "gully trap", "roof gutter", "discarded receptacle"],
    "landed_home": ["flower pot plate", "roof gutter", "gully trap", "ornamental container", "pail", "discarded receptacle"],
    "condo": ["planter box", "gully trap", "roof gutter", "puddle", "ornamental container"],
    "construction_site": ["floor slab ponding", "lift well", "pail", "plastic sheet", "open trench", "drum", "discarded receptacle"],
    "school": ["roof gutter", "puddle", "tree hole", "gully trap", "discarded receptacle"],
    "market": ["drain", "crate", "gully trap", "discarded receptacle", "puddle"],
    "park": ["tree hole", "puddle", "drain", "roof gutter", "discarded receptacle"],
}
TEAMS = ["Team Alpha", "Team Bravo", "Team Charlie"]
INSPECTORS = [f"Demo Inspector {i}" for i in range(1, 7)]


def title(s: str) -> str:
    return " ".join(w.capitalize() for w in s.split())


def point_in(geom) -> Point:
    minx, miny, maxx, maxy = geom.bounds
    for _ in range(500):
        p = Point(random.uniform(minx, maxx), random.uniform(miny, maxy))
        if geom.contains(p):
            return p
    return geom.representative_point()


def main() -> None:
    zones = gpd.read_file(WEB_DATA / "subzones.geojson")
    scores = json.loads((WEB_DATA / "scores.geojson").read_text())
    rank = {f["properties"]["subzone_id"]: f["properties"]["rank"] for f in scores["features"]}
    zones = zones[zones["residents"] >= 100]

    premises = []
    for _, z in zones.iterrows():
        n = min(8, 3 + int(z["vulnerable"]) // 4000)
        counters: dict[str, int] = {}
        for _ in range(n):
            t, _, label, _, layouts = random.choices(TYPES, weights=[x[1] for x in TYPES])[0]
            counters[t] = counters.get(t, 0) + 1
            number = random.randint(101, 699) if t == "hdb_block" else counters[t]
            p = point_in(z.geometry)
            premises.append({
                "code": f"DEMO-{z['subzone_id']}-{len([q for q in premises if q['subzone_id'] == z['subzone_id']]) + 1:02d}",
                "name": f"Demo {label} {number}, {title(z['subzone'])}",
                "premises_type": t, "subzone_id": z["subzone_id"],
                "lat": round(p.y, 6), "lon": round(p.x, 6),
                "layout_notes": random.choice(layouts), "is_demo": True,
            })

    # Past inspections: concentrated in higher-ranked areas, as a real team's would be.
    weeks = [TODAY - dt.timedelta(weeks=w) for w in range(WEEKS - 1, -1, -1)]
    prob = {t[0]: t[3] for t in TYPES}
    repeat_codes = set(random.sample([p["code"] for p in premises if (rank.get(p["subzone_id"]) or 999) <= 60], 14))
    inspections = []
    for p in premises:
        r = rank.get(p["subzone_id"]) or 999
        visit_p = 0.45 if r <= 40 else 0.25 if r <= 100 else 0.08
        for wk_end in weeks:
            repeat = p["code"] in repeat_codes
            if not repeat and random.random() > visit_p:
                continue
            day = wk_end - dt.timedelta(days=random.randint(0, 4))
            if day > TODAY:
                continue
            breeding = random.random() < (0.55 if repeat else prob[p["premises_type"]])
            found = random.sample(HABITATS[p["premises_type"]], k=random.randint(1, 3))
            habitats = [{"type": h, "location": None, "breeding": breeding and i == 0, "count": random.randint(1, 4)} for i, h in enumerate(found)]
            if breeding and random.random() < 0.3 and len(habitats) > 1:
                habitats[1]["breeding"] = True
            follow = breeding
            due = day + dt.timedelta(days=7) if follow else None
            done = bool(follow and due and due < TODAY - dt.timedelta(days=2) and random.random() < 0.7)
            year, week = date_to_epi_week(day)
            inspections.append({
                "premises_code": p["code"], "inspected_on": day.isoformat(), "epi_week": epi_label(year, week),
                "team_name": random.choice(TEAMS), "inspector": random.choice(INSPECTORS),
                "breeding_found": breeding, "habitats": habitats,
                "actions_taken": ("Larvae destroyed and habitat removed; larvicide applied; advisory left with occupier."
                                  if breeding else "Potential habitats checked and cleared; no breeding found."),
                "follow_up_needed": follow, "follow_up_due": due.isoformat() if due else None, "follow_up_done": done,
                "is_demo": True,
            })

    out = ROOT / "db" / "demo_seed.json"
    out.write_text(json.dumps({"note": "DEMO DATA: fictional premises and inspections for demonstrating the Copilot.",
                               "generated_for": TODAY.isoformat(), "premises": premises, "inspections": inspections}))
    br = sum(i["breeding_found"] for i in inspections)
    print(f"{len(premises)} demo premises in {zones.shape[0]} subzones; {len(inspections)} demo inspections "
          f"({br} with breeding) over {WEEKS} weeks; {len(repeat_codes)} premises seeded as repeat-breeding candidates.")


if __name__ == "__main__":
    main()
