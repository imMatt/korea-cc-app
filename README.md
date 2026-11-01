# Korea Cross Country · trip companion

A small static web app for the Korea Cross Country cycle route (about 606 km, Incheon to Busan).
No build step and no framework. Plain ES modules plus Leaflet for the map.

## What it does

- **Days:** a flexible day-by-day plan. Drag a day end with ±1/±5 buttons, type a km, or tap a nearby stop. Each day shows distance, climb, ride time, arrival, sunset, and warnings (over your daily limit, arriving close to sunset). "Even out from here" re-spreads the remaining distance. Notes and bookings are per day.
- **Map:** the route coloured by day, with day-end pins, suggested stops (filterable), and an elevation profile. Tap the profile to pick a km and assign it to a day.
- **Stops:** searchable list of towns, lodging, and shops from OpenStreetMap, plus a **resupply gap** list. Stretches with no convenience store or bike shop of at least the threshold (default 20 km) are flagged.
- **Live:** GPS position on the route, distance to the end of the day, next shop and lodging ahead, sunset, off-track warning. Needs the screen on.
- **Settings:** trip dates, speed, climbing rate, daily limit, gap threshold, GPX import, plan export/import.

Plans are saved in the browser on the device that made them. Use Settings → Export to keep a copy.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

The app fetches JSON, so it needs a server rather than `file://`.

## Deploy to GitHub Pages (free)

1. Push this repo to GitHub.
2. Repo → **Settings → Pages** → Source: *Deploy from a branch* → Branch `main`, folder `/ (root)`.
3. Wait a minute, then open `https://<you>.github.io/<repo>/`.
4. On the iPhone: open the link in Safari → Share → **Add to Home Screen**.

Location (Live) needs HTTPS, which GitHub Pages provides.

## Data

- `data/route.json` is the track, simplified to `[lat, lon, ele, km]`, built from the GPX.
- `data/stops.json` holds towns, lodging, and shops within 4 km of the track, from OpenStreetMap (ODbL).

To rebuild both from a GPX (standard library only):

```sh
python3 scripts/build_data.py path/to/CrossCountry.gpx
```

Stop data is only as good as OpenStreetMap. Rural coverage is patchy, so a flagged resupply gap may just be missing data. Check locally before relying on it.

## Notes

- Sunrise and sunset use a standard approximation, accurate to a few minutes.
- Times are estimates from your speed and climbing settings and exclude breaks.
- The bundled map tiles come from OpenStreetMap's public tile server, which is fine for personal use.
