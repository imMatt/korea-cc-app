import { state, changed, setDayEnd } from '../state.js';
import { serviceGaps, SERVICE_TYPES, TOWN_TYPES, isLodging } from '../geo.js';
import { esc, fmtKm } from '../util.js';

const LIMIT = 250;
const view = { query: '', kind: 'all', day: 0 };

function matchesKind(type) {
  switch (view.kind) {
    case 'shop': return SERVICE_TYPES.has(type);
    case 'town': return TOWN_TYPES.has(type);
    case 'lodging': return isLodging(type);
    default: return true;
  }
}

export function renderStops($root) {
  const { plan, route, stops } = state;
  const total = route.total_km;

  if (state.isCustom) {
    $root.innerHTML = `<div class="card"><h2>Stops</h2>
      <p>Suggested stops come from the bundled route's OpenStreetMap data, so they aren't available for an imported GPX.
      Use Map to set day ends by eye, or switch back to the bundled route in Settings.</p></div>`;
    return;
  }

  const gaps = serviceGaps(route, stops, 5);
  const threshold = plan.gap_km;
  const major = gaps.filter((g) => g.len >= threshold);

  const dayOptions = plan.days.map((_, i) => `<option value="${i}" ${i === view.day ? 'selected' : ''}>Day ${i + 1}</option>`).join('');
  const q = view.query.trim().toLowerCase();
  const matching = stops.filter((s) => matchesKind(s.type) && (!q || s.name.toLowerCase().includes(q) || (s.name_ko || '').includes(q)));
  const shown = matching.slice(0, LIMIT);

  $root.innerHTML = `
    <section class="card">
      <h2>Resupply gaps</h2>
      <p class="muted">Stretches with no convenience store or bike shop from OpenStreetMap. Gaps of ${threshold} km or more are flagged. Rural coverage in OSM is patchy, so a flagged gap may just be missing data. Check locally.</p>
      ${major.length ? `<ul class="gap-list">${major.map((g) => `
        <li class="flag">
          <strong>${fmtKm(g.from)} → ${fmtKm(g.to)} km</strong>
          <span>${fmtKm(g.len)} km with no shop</span>
          <span class="muted">Day ${dayOfKm(plan, g.from)}</span>
        </li>`).join('')}</ul>` : `<p class="ok-line">No gaps of ${threshold} km or more.</p>`}
      <details><summary>All gaps of 5 km or more (${gaps.length})</summary>
        <ul class="gap-list">${gaps.map((g) => `
          <li><span>${fmtKm(g.from)} → ${fmtKm(g.to)} km</span><span class="muted">${fmtKm(g.len)} km</span></li>`).join('')}</ul>
      </details>
    </section>

    <section class="card">
      <h2>Suggested stops</h2>
      <div class="filters">
        <input type="search" id="stop-q" placeholder="Search name" value="${esc(view.query)}">
        <select id="stop-kind">
          <option value="all" ${view.kind === 'all' ? 'selected' : ''}>Everything</option>
          <option value="town" ${view.kind === 'town' ? 'selected' : ''}>Major towns</option>
          <option value="lodging" ${view.kind === 'lodging' ? 'selected' : ''}>Lodging</option>
          <option value="shop" ${view.kind === 'shop' ? 'selected' : ''}>Shops</option>
        </select>
      </div>
      <label class="inline">Use as end of <select id="stop-day">${dayOptions}</select></label>
      <p class="muted">${matching.length} matching${matching.length > LIMIT ? `, showing first ${LIMIT}` : ''}. Tap “Set end” to move a day boundary.</p>
      <ul class="stop-list">
        ${shown.map((s, idx) => `
          <li>
            <span class="km">${fmtKm(s.km)}</span>
            <span class="stop-name">${esc(s.name)}${s.name_ko && s.name_ko !== s.name ? ` <span class="muted">${esc(s.name_ko)}</span>` : ''}</span>
            <span class="muted">${esc(s.type.replace('lodging:', '').replace('shop:', 'shop '))}</span>
            <button data-stop="${idx}">Set end</button>
          </li>`).join('')}
      </ul>
    </section>`;

  $root.querySelector('#stop-q').addEventListener('input', (e) => {
    view.query = e.target.value;
    renderStops($root);
    $root.querySelector('#stop-q').focus();
    const el = $root.querySelector('#stop-q');
    el.setSelectionRange(el.value.length, el.value.length);
  });
  $root.querySelector('#stop-kind').addEventListener('change', (e) => {
    view.kind = e.target.value;
    renderStops($root);
  });
  $root.querySelector('#stop-day').addEventListener('change', (e) => {
    view.day = Number(e.target.value);
  });
  $root.querySelector('.stop-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-stop]');
    if (!btn) return;
    const s = shown[Number(btn.dataset.stop)];
    setDayEnd(plan, view.day, s.km, total);
    changed();
  });
}

function dayOfKm(plan, km) {
  let prev = 0;
  for (let i = 0; i < plan.days.length; i++) {
    if (km <= plan.days[i].end_km + 1e-9 && km >= prev) return i + 1;
    prev = plan.days[i].end_km;
  }
  return plan.days.length;
}
