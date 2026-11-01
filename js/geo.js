// Geometry helpers: distance, route preparation, km lookups, service gaps.

export const SERVICE_TYPES = new Set(['shop:convenience', 'shop:bicycle']);
// Major places only. Villages and neighbourhoods are too granular to suggest.
export const TOWN_TYPES = new Set(['city', 'town']);

export function isLodging(type) {
  return type.startsWith('lodging:');
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Parse GPX text into { name, pts: [[lat, lon, ele], ...] }.
export function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('That file is not valid XML/GPX.');
  let nodes = [...doc.getElementsByTagName('trkpt')];
  if (nodes.length < 2) nodes = [...doc.getElementsByTagName('rtept')];
  if (nodes.length < 2) throw new Error('No track points found in that GPX file.');
  const nameEl = doc.getElementsByTagName('trk')[0]?.getElementsByTagName('name')[0];
  const name = nameEl?.textContent?.trim() || 'Imported route';
  const pts = nodes.map((n) => {
    const ele = n.getElementsByTagName('ele')[0];
    return [parseFloat(n.getAttribute('lat')), parseFloat(n.getAttribute('lon')), ele ? parseFloat(ele.textContent) : 0];
  });
  return { name, pts };
}

// Build a raw route ({ name, total_km, points: [lat, lon, ele, km] }) from [lat, lon, ele] points.
export function rawRouteFromPoints(name, pts) {
  let km = 0;
  const points = pts.map((p, i) => {
    if (i > 0) km += haversineKm(pts[i - 1][0], pts[i - 1][1], p[0], p[1]);
    return [p[0], p[1], Math.round(p[2] * 10) / 10, Math.round(km * 1000) / 1000];
  });
  return { name, total_km: Math.round(km * 100) / 100, points };
}

function smooth(values, window) {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      sum += values[j];
      count++;
    }
    return sum / count;
  });
}

// Add derived arrays used for fast lookups: km index, smoothed elevation, cumulative gain/loss.
export function prepareRoute(raw) {
  const points = raw.points;
  const ele = smooth(points.map((p) => p[2]), 11);
  const gain = new Float64Array(points.length);
  const loss = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++) {
    const dz = ele[i] - ele[i - 1];
    gain[i] = gain[i - 1] + (dz > 0 ? dz : 0);
    loss[i] = loss[i - 1] + (dz < 0 ? -dz : 0);
  }
  const total = raw.total_km ?? points[points.length - 1][3];
  return {
    name: raw.name,
    total_km: total,
    points,
    km: points.map((p) => p[3]),
    ele,
    gain,
    loss,
  };
}

// Index of the last point at or before km.
export function indexAtKm(route, km) {
  const kms = route.km;
  const last = kms.length - 1;
  if (km <= kms[0]) return 0;
  if (km >= kms[last]) return last;
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (kms[mid] <= km) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Climb and descent (metres, smoothed) between two km marks.
export function elevStats(route, aKm, bKm) {
  const i = indexAtKm(route, aKm);
  const j = indexAtKm(route, bKm);
  return { gain: route.gain[j] - route.gain[i], loss: route.loss[j] - route.loss[i] };
}

// Nearest route point to a lat/lon, with straight-line offset in km.
export function nearestOnRoute(route, lat, lon) {
  let best = 0;
  let bestD = Infinity;
  const pts = route.points;
  for (let i = 0; i < pts.length; i++) {
    const dLat = pts[i][0] - lat;
    const dLon = (pts[i][1] - lon) * Math.cos((lat * Math.PI) / 180);
    const d2 = dLat * dLat + dLon * dLon; // cheap pre-filter in degrees
    if (d2 < bestD) {
      bestD = d2;
      best = i;
    }
  }
  return { index: best, km: pts[best][3], offsetKm: haversineKm(lat, lon, pts[best][0], pts[best][1]) };
}

// Gaps between consecutive resupply stops (convenience stores, bike shops).
// Start and end of the route count as gap boundaries.
export function serviceGaps(route, stops, minKm = 5) {
  const marks = [0];
  for (const s of stops) if (SERVICE_TYPES.has(s.type)) marks.push(s.km);
  marks.push(route.total_km);
  marks.sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < marks.length; i++) {
    const len = marks[i] - marks[i - 1];
    if (len >= minKm) gaps.push({ from: marks[i - 1], to: marks[i], len });
  }
  return gaps;
}
