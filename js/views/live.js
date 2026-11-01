/* global L */
import { state, dayStarts, dayDate } from '../state.js';
import { nearestOnRoute, serviceGaps, SERVICE_TYPES, TOWN_TYPES, isLodging } from '../geo.js';
import { sunTimes } from '../sun.js';
import { esc, fmtKm, fmtKst } from '../util.js';

const OFF_ROUTE_M = 300;
const DEFAULT_ZOOM = 14;
const COMING_UP_TOWNS = 3;
const COMING_UP_LODGING = 2;

let watchId = null;
let last = null;          // latest derived reading
let firstFix = true;      // centre on the first fix of a session
let follow = true;        // keep the position centred while tracking

// Map state, rebuilt on each render of this view
let liveMap = null;
let routeLatLngs = null;  // cached [lat, lon][] for the bundled or imported route
let routeCacheKey = null;
let fullRouteLayer = null;
let travelLayer = null;
let posMarker = null;
let accuracyCircle = null;
let extrasLayer = null;

export function stopLive() {
  if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  destroyMap();
}

function destroyMap() {
  if (liveMap) liveMap.remove();
  liveMap = null;
  fullRouteLayer = travelLayer = posMarker = accuracyCircle = extrasLayer = null;
}

function latLngsFor(route) {
  if (routeCacheKey !== route) {
    routeLatLngs = route.points.map((p) => [p[0], p[1]]);
    routeCacheKey = route;
  }
  return routeLatLngs;
}

function dayIndexAt(plan, km) {
  const starts = dayStarts(plan);
  for (let i = 0; i < plan.days.length; i++) {
    if (km >= starts[i] && km <= plan.days[i].end_km + 1e-9) return i;
  }
  return plan.days.length - 1;
}

function derive(pos) {
  const { route, plan, stops } = state;
  const { latitude, longitude, accuracy } = pos.coords;
  const near = nearestOnRoute(route, latitude, longitude);
  const km = near.km;
  const i = dayIndexAt(plan, km);
  const endKm = plan.days[i].end_km;
  const endPt = route.points[route.km.findIndex((k) => k >= endKm)] || route.points[route.points.length - 1];
  const sun = sunTimes(dayDate(plan, i), endPt[0], endPt[1]);

  let nextShop = null;
  let nextLodging = null;
  if (!state.isCustom) {
    for (const s of stops) {
      if (s.km <= km + 0.05) continue;
      if (!nextShop && SERVICE_TYPES.has(s.type)) nextShop = s;
      if (!nextLodging && s.type.startsWith('lodging:')) nextLodging = s;
      if (nextShop && nextLodging) break;
    }
  }
  // Next few towns and lodging options ahead (shops are covered by "Next shop").
  // Up to 3 towns and 2 lodging options, merged in route order.
  let upcoming = [];
  if (!state.isCustom) {
    const towns = [];
    const lodging = [];
    for (const s of stops) {
      if (s.km <= km + 0.05) continue;
      if (TOWN_TYPES.has(s.type) && towns.length < COMING_UP_TOWNS) towns.push(s);
      else if (isLodging(s.type) && lodging.length < COMING_UP_LODGING) lodging.push(s);
      if (towns.length === COMING_UP_TOWNS && lodging.length === COMING_UP_LODGING) break;
    }
    upcoming = [...towns, ...lodging].sort((a, b) => a.km - b.km);
  }
  const gapAhead = state.isCustom
    ? null
    : serviceGaps(route, stops, 5).find((g) => g.from <= km && g.to > km && g.len >= state.plan.gap_km);

  return {
    lat: latitude,
    lon: longitude,
    accuracy,
    km,
    index: near.index,
    offsetM: near.offsetKm * 1000,
    dayNo: i,
    toDayEnd: endKm - km,
    toEnd: route.total_km - km,
    nextShop,
    nextLodging,
    upcoming,
    gapAhead,
    sunset: sun?.set,
    time: new Date(pos.timestamp),
  };
}

// ---- Map ----

function buildMap($root) {
  destroyMap();
  const { route } = state;
  liveMap = L.map($root.querySelector('#live-map'), { preferCanvas: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(liveMap);

  const ll = latLngsFor(route);
  fullRouteLayer = L.polyline(ll, { color: '#7f8c95', weight: 4, opacity: 0.8 }).addTo(liveMap);
  travelLayer = L.polyline([], { color: '#2d5a70', weight: 5 }).addTo(liveMap);
  extrasLayer = L.layerGroup().addTo(liveMap);
  liveMap.fitBounds(fullRouteLayer.getBounds(), { padding: [12, 12] });

  // Dragging the map by hand stops auto-follow until the user re-centres.
  liveMap.on('dragstart', () => {
    follow = false;
    updateFollowButton($root);
  });

  if (last) updatePosition(last);
}

function updatePosition(d) {
  if (!liveMap) return;
  const { route } = state;
  const ll = [d.lat, d.lon];

  if (!posMarker) {
    posMarker = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#e4572e', fillOpacity: 1 }).addTo(liveMap);
    accuracyCircle = L.circle(ll, { radius: d.accuracy, color: '#e4572e', weight: 1, fillOpacity: 0.1 }).addTo(liveMap);
  } else {
    posMarker.setLatLng(ll);
    accuracyCircle.setLatLng(ll).setRadius(d.accuracy);
  }

  travelLayer.setLatLngs(latLngsFor(route).slice(0, d.index + 1));

  extrasLayer.clearLayers();
  if (d.nextShop) {
    const p = route.points[nearestIndexForKm(route, d.nextShop.km)];
    L.circleMarker([p[0], p[1]], { radius: 6, color: '#fff', weight: 2, fillColor: '#d7263d', fillOpacity: 1 })
      .bindTooltip(`Next shop: ${d.nextShop.name}`).addTo(extrasLayer);
  }
  if (d.nextLodging) {
    const p = route.points[nearestIndexForKm(route, d.nextLodging.km)];
    L.circleMarker([p[0], p[1]], { radius: 6, color: '#fff', weight: 2, fillColor: '#3a5bff', fillOpacity: 1 })
      .bindTooltip(`Next lodging: ${d.nextLodging.name}`).addTo(extrasLayer);
  }

  if (firstFix) {
    liveMap.setView(ll, DEFAULT_ZOOM);
    firstFix = false;
  } else if (follow) {
    liveMap.panTo(ll, { animate: true });
  }
}

function nearestIndexForKm(route, km) {
  return route.km.findIndex((k) => k >= km);
}

function updateFollowButton($root) {
  const btn = $root.querySelector('#live-follow');
  if (btn) btn.textContent = follow ? 'Following' : 'Re-centre';
}

// ---- Panel ----

function panel(d) {
  const minsOfLight = d.sunset ? (d.sunset - new Date()) / 60000 : null;
  return `
    <div class="live-big">
      <span class="muted">You are at</span>
      <strong>km ${fmtKm(d.km)}</strong>
      <span class="muted">of ${fmtKm(state.route.total_km)} km</span>
    </div>
    <div class="stat-grid">
      <div><span class="muted">Day</span><strong>${d.dayNo}</strong></div>
      <div><span class="muted">To end of today</span><strong>${fmtKm(d.toDayEnd)} km</strong></div>
      <div><span class="muted">To route end</span><strong>${fmtKm(d.toEnd)} km</strong></div>
      <div><span class="muted">Sunset at today's stop</span><strong>${fmtKst(d.sunset)}</strong></div>
    </div>
    ${d.offsetM > OFF_ROUTE_M
      ? `<p class="warn-line">⚠ About ${Math.round(d.offsetM)} m off the track.</p>`
      : '<p class="ok-line">On the track.</p>'}
    ${minsOfLight !== null && minsOfLight > 0 && minsOfLight < 60
      ? '<p class="warn-line">⚠ Under an hour of daylight left at today\'s stop.</p>' : ''}
    ${d.gapAhead ? `<p class="warn-line">Resupply gap ahead: ${fmtKm(d.gapAhead.len)} km with no shops (km ${fmtKm(d.gapAhead.from)} → ${fmtKm(d.gapAhead.to)}).</p>` : ''}
    ${d.nextShop ? `<p>Next shop: <strong>${esc(d.nextShop.name)}</strong> at km ${fmtKm(d.nextShop.km)} (${fmtKm(d.nextShop.km - d.km)} km ahead)</p>` : ''}
    ${d.nextLodging ? `<p>Next lodging: <strong>${esc(d.nextLodging.name)}</strong> at km ${fmtKm(d.nextLodging.km)} (${fmtKm(d.nextLodging.km - d.km)} km ahead)</p>` : ''}
    ${d.upcoming.length ? `
    <h3 class="coming-up-title">Coming up</h3>
    <ol class="coming-up">
      ${d.upcoming.map((s) => `
        <li>
          <span class="stop-name">${esc(s.name)}</span>
          <span class="muted">${esc(s.type.replace('lodging:', ''))} · km ${fmtKm(s.km)}</span>
          <span class="ahead">${fmtKm(s.km - d.km)} km</span>
        </li>`).join('')}
    </ol>` : ''}
    <p class="muted small">GPS accuracy ±${Math.round(d.accuracy)} m · last fix ${d.time.toLocaleTimeString('en-GB')}</p>`;
}

// ---- View ----

export function renderLive($root) {
  if (!('geolocation' in navigator)) {
    $root.innerHTML = '<div class="card"><p>This browser does not support location.</p></div>';
    return;
  }
  const tracking = watchId !== null;
  $root.innerHTML = `
    <section class="card">
      <h2>Where am I?</h2>
      <p class="muted">Uses your phone's GPS while this page is open. Keep the screen on or position updates will stop. A power bank helps.</p>
      <div class="actions">
        <button id="live-toggle">${tracking ? 'Stop tracking' : 'Start tracking'}</button>
        <button id="live-follow" ${tracking ? '' : 'disabled'}>${follow ? 'Following' : 'Re-centre'}</button>
      </div>
      <div id="live-map" class="map live-map" role="region" aria-label="Live position map"></div>
      <div class="legend">
        <span class="chip"><span class="dot" style="background:#7f8c95"></span>Route</span>
        <span class="chip"><span class="dot" style="background:#2d5a70"></span>Ridden</span>
        <span class="chip"><span class="dot" style="background:#e4572e"></span>You</span>
        <span class="chip"><span class="dot" style="background:#d7263d"></span>Next shop</span>
        <span class="chip"><span class="dot" style="background:#3a5bff"></span>Next lodging</span>
      </div>
      <div id="live-body">${tracking && last ? panel(last) : '<p class="muted">Not tracking.</p>'}</div>
    </section>`;

  buildMap($root);

  $root.querySelector('#live-follow').addEventListener('click', () => {
    follow = true;
    updateFollowButton($root);
    if (last && liveMap) liveMap.panTo([last.lat, last.lon], { animate: true });
  });

  $root.querySelector('#live-toggle').addEventListener('click', () => {
    if (watchId !== null) {
      stopLive();
      last = null;
      renderLive($root);
      return;
    }
    firstFix = true;
    follow = true;
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        last = derive(pos);
        const body = $root.querySelector('#live-body');
        if (body) body.innerHTML = panel(last);
        updatePosition(last);
      },
      (err) => {
        // PERMISSION_DENIED (1) will not recover on its own, so stop watching.
        if (err.code === 1) {
          stopLive();
          last = null;
          renderLive($root);
        }
        const body = $root.querySelector('#live-body');
        if (body) body.innerHTML = `<p class="warn-line">Could not get location: ${esc(err.message)}</p>`;
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    renderLive($root);
  });
}
