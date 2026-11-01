import { state, changed, setDayEnd, dayStarts, dayDate, evenOutFrom, round1 } from '../state.js';
import { elevStats, indexAtKm, isLodging, TOWN_TYPES } from '../geo.js';
import { sunTimes } from '../sun.js';
import { esc, fmtKm, fmtHours, fmtDay, fmtKst, fmtM } from '../util.js';

const SUGGEST_WINDOW_KM = 10;
const SUGGEST_MAX_TOWNS = 3;
const SUGGEST_MAX_LODGING = 2;

function dayStats(plan, route, i) {
  const starts = dayStarts(plan);
  const start = starts[i];
  const end = plan.days[i].end_km;
  const dist = end - start;
  const { gain, loss } = elevStats(route, start, end);
  const rideH = dist / plan.avg_kmh + gain / plan.climb_m_per_h;

  const date = dayDate(plan, i);
  const departAt = new Date(`${date}T${plan.depart_time}:00+09:00`);
  const arriveAt = new Date(departAt.getTime() + rideH * 3600e3);
  const endPt = route.points[indexAtKm(route, end)];
  const sun = sunTimes(date, endPt[0], endPt[1]);
  const lightLeftMin = sun ? (sun.set - arriveAt) / 60000 : null;
  return { start, end, dist, gain, loss, rideH, departAt, arriveAt, sunset: sun?.set, lightLeftMin, date };
}

// Major towns first, then a couple of lodging options, both nearest the end point.
function nearbySuggestions(stops, km) {
  const near = (pred) => stops
    .filter((s) => pred(s) && Math.abs(s.km - km) <= SUGGEST_WINDOW_KM)
    .sort((a, b) => Math.abs(a.km - km) - Math.abs(b.km - km));
  const towns = near((s) => TOWN_TYPES.has(s.type)).slice(0, SUGGEST_MAX_TOWNS);
  const lodging = near((s) => isLodging(s.type)).slice(0, SUGGEST_MAX_LODGING);
  return [...towns, ...lodging];
}

function shopsBetween(stops, a, b) {
  return stops.filter((s) => s.type.startsWith('shop:') && s.km > a && s.km <= b).length;
}

function dayCard(i, plan, route, stops) {
  const total = route.total_km;
  const st = dayStats(plan, route, i);
  const day = plan.days[i];
  const warnings = [];
  if (st.dist > plan.max_day_km) warnings.push(`Over your ${plan.max_day_km} km daily limit`);
  if (st.dist < 0.5) warnings.push('Very short day');
  if (st.lightLeftMin !== null && st.lightLeftMin < 30) {
    warnings.push(st.lightLeftMin < 0 ? 'Arrives after sunset at this pace' : 'Arrives less than 30 min before sunset');
  }
  const suggestions = state.isCustom ? [] : nearbySuggestions(stops, st.end);
  const shops = state.isCustom ? null : shopsBetween(stops, st.start, st.end);

  return `
  <article class="card day" data-day="${i}">
    <header class="day-head">
      <h2>Day ${i + 1}</h2>
      <span class="muted">${fmtDay(st.date)}</span>
    </header>

    <div class="km-row">
      <span class="km-from">${fmtKm(st.start)} km</span>
      <span class="arrow">→</span>
      <input type="number" class="km-input" step="0.5" min="${fmtKm(st.start + 0.1)}" max="${total}"
             value="${fmtKm(st.end)}" data-end="${i}" aria-label="End km for day ${i + 1}">
      <div class="nudge">
        <button data-nudge="${i}" data-by="-5">−5</button>
        <button data-nudge="${i}" data-by="-1">−1</button>
        <button data-nudge="${i}" data-by="1">+1</button>
        <button data-nudge="${i}" data-by="5">+5</button>
      </div>
    </div>

    <p class="stats">
      <strong>${fmtKm(st.dist)} km</strong>
      · ↑ ${fmtM(st.gain)} ↓ ${fmtM(st.loss)}
      · ride ~${fmtHours(st.rideH)}
      · depart ${fmtKst(st.departAt)} → arrive ~${fmtKst(st.arriveAt)}
      · sunset ${fmtKst(st.sunset)}
      ${shops === null ? '' : `· ${shops} shop${shops === 1 ? '' : 's'} on route`}
    </p>

    ${warnings.map((w) => `<p class="warn-line">⚠ ${esc(w)}</p>`).join('')}

    ${suggestions.length ? `
    <details class="suggest" open>
      <summary>Stops near km ${fmtKm(st.end)}</summary>
      <ul>
        ${suggestions.map((s) => {
          const diff = s.km - st.end;
          const where = Math.abs(diff) < 0.05 ? 'at end' : `${diff > 0 ? '+' : '−'}${fmtKm(Math.abs(diff))} km`;
          return `<li>
            <span class="stop-name">${esc(s.name)}</span>
            <span class="muted">${esc(s.type.replace('lodging:', ''))}${s.near_town ? ` at ${esc(s.near_town)}` : ''} · ${where}</span>
            <button data-set-end="${i}" data-km="${s.km}">Set end</button>
          </li>`;
        }).join('')}
      </ul>
    </details>` : ''}

    <label class="field">Notes
      <textarea rows="2" data-field="notes" data-day="${i}">${esc(day.notes)}</textarea>
    </label>
    <label class="field">Accommodation / booking
      <input type="text" data-field="booked" data-day="${i}" value="${esc(day.booked)}" placeholder="Not booked yet">
    </label>

    <div class="actions">
      <button data-even="${i}">Even out from here</button>
      <button data-remove="${i}" class="danger">Remove day</button>
    </div>
  </article>`;
}

function summary(plan, route) {
  const total = route.total_km;
  const lastEnd = plan.days[plan.days.length - 1].end_km;
  const remaining = total - lastEnd;
  const days = plan.days.length;
  const minDays = Math.ceil(total / plan.max_day_km);
  return `
  <section class="card summary">
    <div class="stat-grid">
      <div><span class="muted">Route</span><strong>${fmtKm(total)} km</strong></div>
      <div><span class="muted">Days planned</span><strong>${days}</strong></div>
      <div><span class="muted">Average / day</span><strong>${fmtKm(total / days)} km</strong></div>
      <div><span class="muted">Min days at ${plan.max_day_km} km</span><strong>${minDays}</strong></div>
    </div>
    ${Math.abs(remaining) < 0.05
      ? '<p class="ok-line">Plan covers the whole route.</p>'
      : remaining > 0
        ? `<p class="warn-line">⚠ ${fmtKm(remaining)} km not yet planned. Add a day or extend the last one.</p>`
        : `<p class="warn-line">⚠ Last day ends ${fmtKm(-remaining)} km past the route end.</p>`}
    <div class="actions">
      <button id="split-longest">Split longest day</button>
      <button id="add-day">Add day at end</button>
    </div>
  </section>`;
}

function shakedownCard(plan, route) {
  const sh = plan.shakedown;
  if (!sh.enabled) return '';
  const rideH = sh.km / plan.avg_kmh;
  const departAt = new Date(`${sh.date}T${plan.depart_time}:00+09:00`);
  const arriveAt = new Date(departAt.getTime() + rideH * 3600e3);
  const sun = sunTimes(sh.date, route.points[0][0], route.points[0][1]);
  return `
  <article class="card day shakedown">
    <header class="day-head">
      <h2>Day 0 · Shakedown</h2>
      <span class="muted">${fmtDay(sh.date)}</span>
    </header>
    <label class="field">Distance (km)
      <input type="number" step="1" min="1" data-shake="km" value="${fmtKm(sh.km)}">
    </label>
    <p class="stats">
      <strong>${fmtKm(sh.km)} km</strong>
      · ride ~${fmtHours(rideH)}
      · depart ${fmtKst(departAt)} → arrive ~${fmtKst(arriveAt)}
      · sunset ${fmtKst(sun?.set)}
    </p>
    <p class="muted small">Not counted toward route km. Use it to check the bikes and kit before the start.</p>
    <label class="field">Notes
      <textarea rows="2" data-shake="notes">${esc(sh.notes)}</textarea>
    </label>
  </article>`;
}

export function renderDays($root) {
  const { plan, route, stops } = state;
  const total = route.total_km;

  $root.innerHTML = `
    ${shakedownCard(plan, route)}
    ${summary(plan, route)}
    ${plan.days.map((_, i) => dayCard(i, plan, route, stops)).join('')}
    <p class="muted footnote">Times assume ${plan.avg_kmh} km/h on the flat plus ${plan.climb_m_per_h} m/h of climbing. Change these in Settings.</p>`;

  $root.onclick = (e) => {
    const el = e.target.closest('button');
    if (!el) return;
    const d = el.dataset;
    if (el.id === 'add-day') {
      const last = plan.days[plan.days.length - 1].end_km;
      if (last >= total) return;
      plan.days.push({ end_km: total, notes: '', booked: '' });
    } else if (el.id === 'split-longest') {
      const starts = dayStarts(plan);
      let best = 0;
      plan.days.forEach((_, i) => {
        if (plan.days[i].end_km - starts[i] > plan.days[best].end_km - starts[best]) best = i;
      });
      const mid = round1((starts[best] + plan.days[best].end_km) / 2);
      plan.days.splice(best + 1, 0, { end_km: plan.days[best].end_km, notes: '', booked: '' });
      plan.days[best].end_km = mid;
    } else if (d.nudge !== undefined) {
      const i = Number(d.nudge);
      setDayEnd(plan, i, plan.days[i].end_km + Number(d.by), total);
    } else if (d.setEnd !== undefined) {
      setDayEnd(plan, Number(d.setEnd), Number(d.km), total);
    } else if (d.even !== undefined) {
      evenOutFrom(plan, Number(d.even), total);
    } else if (d.remove !== undefined) {
      if (plan.days.length === 1) return;
      plan.days.splice(Number(d.remove), 1);
    } else {
      return;
    }
    changed();
  };

  $root.onchange = (e) => {
    const el = e.target;
    if (el.dataset.shake !== undefined) {
      if (el.dataset.shake === 'km') {
        const km = Number(el.value);
        if (!(km > 0)) return;
        plan.shakedown.km = km;
      } else {
        plan.shakedown[el.dataset.shake] = el.value;
      }
      changed();
    } else if (el.dataset.end !== undefined) {
      setDayEnd(plan, Number(el.dataset.end), Number(el.value), total);
      changed();
    } else if (el.dataset.field) {
      plan.days[Number(el.dataset.day)][el.dataset.field] = el.value;
      changed(); // persists; re-render is harmless here
    }
  };
}
