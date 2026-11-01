#!/usr/bin/env python3
"""
Build static route + stop data for the Korea Cross Country trip planner.

Usage:
    python3 scripts/build_data.py path/to/CrossCountry.gpx

Writes:
    data/route.json  - simplified track: points [lat, lon, ele, km] + totals
    data/stops.json  - towns/villages/lodging within MAX_OFFSET_KM of the track,
                       each with its km position along the route

Uses only the Python standard library. Place data comes from OpenStreetMap via
the Overpass API (ODbL). Re-run to refresh; commit the output files.
"""
import json
import math
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

MAX_OFFSET_KM = 4.0     # keep places within this distance of the track
LODGING_NEAR_TOWN_KM = 4.0  # keep lodging only within this distance of a major town
MAJOR_PLACES = {"city", "town"}  # village/hamlet/suburb/neighbourhood are too granular to suggest
BBOX = (35.0, 126.5, 37.7, 129.1)  # south, west, north, east (covers route)
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "korea-cc-trip-planner/1.0 (personal trip tool)"
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def parse_gpx(path):
    ns = "{http://www.topografix.com/GPX/1/1}"
    root = ET.parse(path).getroot()
    pts = []
    for p in root.iter(ns + "trkpt"):
        ele_el = p.find(ns + "ele")
        ele = float(ele_el.text) if ele_el is not None else 0.0
        pts.append((float(p.get("lat")), float(p.get("lon")), ele))
    if len(pts) < 2:
        sys.exit("GPX has no track points")
    return pts


def cumulative_km(pts):
    km = [0.0]
    for a, b in zip(pts, pts[1:]):
        km.append(km[-1] + haversine_km(a[0], a[1], b[0], b[1]))
    return km


def fetch_places():
    s, w, n, e = BBOX
    query = (
        f'[out:json][timeout:180];'
        f'('
        f'nwr["place"~"^(city|town|village|hamlet|suburb|neighbourhood)$"]({s},{w},{n},{e});'
        f'nwr["tourism"~"^(hotel|guest_house|motel|hostel|camp_site)$"]({s},{w},{n},{e});'
        f'nwr["shop"~"^(convenience|bicycle)$"]({s},{w},{n},{e});'
        f');'
        f'out center tags;'
    )
    body = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(OVERPASS_URL, data=body, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=240) as resp:
        return json.load(resp)["elements"]


def build_track_index(pts, cell=0.05):
    grid = {}
    for i, (lat, lon, _) in enumerate(pts):
        grid.setdefault((math.floor(lat / cell), math.floor(lon / cell)), []).append(i)
    return grid, cell


def nearest_track_point(lat, lon, pts, grid, cell):
    ci, cj = math.floor(lat / cell), math.floor(lon / cell)
    best_i, best_d = None, float("inf")
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            for i in grid.get((ci + di, cj + dj), []):
                d = haversine_km(lat, lon, pts[i][0], pts[i][1])
                if d < best_d:
                    best_i, best_d = i, d
    return best_i, best_d


def classify(tags):
    if "place" in tags:
        return tags["place"]
    if "tourism" in tags:
        return "lodging:" + tags["tourism"]
    if "shop" in tags:
        return "shop:" + tags["shop"]
    return "other"


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    gpx_path = sys.argv[1]
    pts = parse_gpx(gpx_path)
    km = cumulative_km(pts)
    total_km = km[-1]

    # ---- route.json (downsampled to roughly one point per 30 m is unnecessary; keep all, rounded)
    route = {
        "name": "Korea Cross Country",
        "total_km": round(total_km, 2),
        "points": [[round(lat, 6), round(lon, 6), round(ele, 1), round(k, 3)]
                   for (lat, lon, ele), k in zip(pts, km)],
    }
    DATA.mkdir(exist_ok=True)
    (DATA / "route.json").write_text(json.dumps(route, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"route.json: {len(pts)} points, {total_km:.1f} km")

    # ---- stops.json
    print("Querying Overpass...")
    elements = fetch_places()
    print(f"Overpass returned {len(elements)} elements")
    grid, cell = build_track_index(pts)

    stops = []
    seen = set()
    for el in elements:
        tags = el.get("tags", {})
        lat = el.get("lat", el.get("center", {}).get("lat"))
        lon = el.get("lon", el.get("center", {}).get("lon"))
        if lat is None or lon is None:
            continue
        name = tags.get("name:en") or tags.get("name") or tags.get("name:ko")
        if not name:
            continue
        idx, offset = nearest_track_point(lat, lon, pts, grid, cell)
        if idx is None or offset > MAX_OFFSET_KM:
            continue
        kind = classify(tags)
        key = (name, kind, round(km[idx], 1))
        if key in seen:
            continue
        seen.add(key)
        stops.append({
            "name": name,
            "name_ko": tags.get("name", ""),
            "type": kind,
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "km": round(km[idx], 2),
            "offset_km": round(offset, 2),
            "osm_id": f'{el["type"]}/{el["id"]}',
        })

    # Suggestions only use major towns. Lodging is kept only near one of them, and
    # shops are kept for resupply/gap analysis. Villages, hamlets, suburbs and
    # neighbourhoods are dropped.
    towns = [s for s in stops if s["type"] in MAJOR_PLACES]
    kept = []
    for s in stops:
        if s["type"] in MAJOR_PLACES or s["type"].startswith("shop:"):
            kept.append(s)
        elif s["type"].startswith("lodging:"):
            near = min(
                ((haversine_km(s["lat"], s["lon"], t["lat"], t["lon"]), t) for t in towns),
                default=None,
                key=lambda x: x[0],
            )
            if near and near[0] <= LODGING_NEAR_TOWN_KM:
                s["near_town"] = near[1]["name"]
                kept.append(s)
    stops = kept
    print(f"after filtering: {len(towns)} major towns, {len(stops)} stops total")

    stops.sort(key=lambda s: s["km"])
    (DATA / "stops.json").write_text(
        json.dumps({"generated_from": Path(gpx_path).name, "max_offset_km": MAX_OFFSET_KM,
                    "source": "OpenStreetMap contributors (ODbL), via Overpass API",
                    "stops": stops}, ensure_ascii=False, indent=1),
        encoding="utf-8")
    print(f"stops.json: {len(stops)} stops within {MAX_OFFSET_KM} km of track")


if __name__ == "__main__":
    main()
