// App state, persistence (localStorage, per device) and plan maths.
import { prepareRoute } from './geo.js';

const KEY_PLAN = 'kcc-plan-v1';
const KEY_ROUTE = 'kcc-custom-route-v1';

export const state = {
  route: null,      // prepared route
  stops: [],        // from data/stops.json (bundled route only)
  isCustom: false,  // true when a user GPX is loaded
  plan: null,
  onChange: () => {},
};

function read(key) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('Could not save to localStorage', err);
  }
}

export const round1 = (v) => Math.round(v * 10) / 10;

// Day 0 shakedown ride. Separate from the route: its km don't count toward the route.
export function defaultShakedown() {
  return { enabled: true, km: 35, date: '2026-11-08', notes: '', booked: '' };
}

export function defaultPlan(totalKm) {
  const n = 9;
  const days = Array.from({ length: n }, (_, i) => ({
    end_km: round1((totalKm * (i + 1)) / n),
    notes: '',
    booked: '',
  }));
  days[n - 1].end_km = round1(totalKm);
  return {
    version: 1,
    start_date: '2026-11-09',
    depart_time: '08:00',
    avg_kmh: 16,
    climb_m_per_h: 350,
    max_day_km: 90,
    gap_km: 20,
    shakedown: defaultShakedown(),
    days,
  };
}

// Make a plan safe for the current route: numbers in range, ends strictly increasing.
export function sanitizePlan(raw, totalKm) {
  const base = defaultPlan(totalKm);
  if (!raw || !Array.isArray(raw.days) || raw.days.length === 0) return base;
  const plan = { ...base, ...pickSettings(raw) };
  plan.shakedown = { ...defaultShakedown(), ...(raw.shakedown || {}) };
  plan.shakedown.km = Math.max(1, Number(plan.shakedown.km) || 35);
  plan.shakedown.enabled = Boolean(plan.shakedown.enabled);
  plan.days = raw.days.map((d) => ({
    end_km: Number(d.end_km) || 0,
    notes: String(d.notes ?? ''),
    booked: String(d.booked ?? ''),
  }));
  let prev = 0;
  for (const d of plan.days) {
    d.end_km = Math.min(totalKm, Math.max(prev + 0.1, round1(d.end_km)));
    prev = d.end_km;
  }
  return plan;
}

function pickSettings(raw) {
  const out = {};
  for (const k of ['start_date', 'depart_time', 'avg_kmh', 'climb_m_per_h', 'max_day_km', 'gap_km']) {
    if (raw[k] !== undefined) out[k] = raw[k];
  }
  return out;
}

export function dayStarts(plan) {
  return plan.days.map((_, i) => (i === 0 ? 0 : plan.days[i - 1].end_km));
}

// Set day i's end, keeping later days after it.
export function setDayEnd(plan, i, km, totalKm) {
  const starts = dayStarts(plan);
  const v = Math.min(totalKm, Math.max(starts[i] + 0.1, round1(km)));
  plan.days[i].end_km = v;
  for (let j = i + 1; j < plan.days.length; j++) {
    if (plan.days[j].end_km <= plan.days[j - 1].end_km) {
      plan.days[j].end_km = Math.min(totalKm, round1(plan.days[j - 1].end_km + 0.1));
    }
  }
}

// Spread the remaining distance from day i evenly across days i..last.
export function evenOutFrom(plan, i, totalKm) {
  const start = dayStarts(plan)[i];
  const n = plan.days.length - i;
  const remaining = totalKm - start;
  for (let j = i; j < plan.days.length; j++) {
    plan.days[j].end_km = round1(start + (remaining * (j - i + 1)) / n);
  }
  plan.days[plan.days.length - 1].end_km = round1(totalKm);
}

export function dayDate(plan, i) {
  const [y, m, d] = plan.start_date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
}

export function persistPlan() {
  write(KEY_PLAN, state.plan);
}

// Persist and re-render the current view.
export function changed() {
  persistPlan();
  state.onChange();
}

export function setRouteRaw(raw, isCustom) {
  state.route = prepareRoute(raw);
  state.isCustom = isCustom;
  state.plan = sanitizePlan(read(KEY_PLAN), state.route.total_km);
  persistPlan();
}

export function loadSavedCustomRoute() {
  return read(KEY_ROUTE);
}

export function saveCustomRoute(raw) {
  write(KEY_ROUTE, raw);
}

export function clearCustomRoute() {
  write(KEY_ROUTE, null);
}

export function importPlan(obj) {
  state.plan = sanitizePlan(obj, state.route.total_km);
  persistPlan();
}
