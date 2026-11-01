/* global L */
import { state, changed, setDayEnd, dayStarts, round1 } from '../state.js';
import { indexAtKm, serviceGaps, SERVICE_TYPES, TOWN_TYPES, isLodging } from '../geo.js';
import { esc, fmtKm } from '../util.js';

const DAY_COLOURS = ['#e4572e', '#17a2b8', '#76b041', '#ffa600', '#8e44ad', '#2f80ed', '#e91e63', '#00897b', '#795548', '#607d8b'];
const GROUP = {
  service: { label: 'Shops (resupply)', colour: '#d7263d' },
  town: { label: 'Major towns', colour: '#1b998b' },
  lodging: { label: 'Lodging', colour: '#3a5bff' },
};
const filters = { service: true, town: true, lodging: true };
let map = null;
let cursorMarker = null;
let cursorKm = null;
let profileCtx = null; // { x0, width, km0, km1 } for pointer mapping

function groupOf(type) {
  if (SERVICE_TYPES.has(type)) return 'service';
  if (TOWN_TYPES.has(type)) return 'town';
  if (isLodging(type)) return 'lodging';
  return null;
}

function dayOfKm(plan, km) {
  const starts = dayStarts(plan);
  for (let i = 0; i < plan.days.length; i++) {
    if (km >= starts[i] && km <= plan.days[i].end_km + 1e-9) return i;
  }
  return plan.days.length - 1;
}

export function renderMap($root) {
  const { plan, route, stops } = state;
  const total = route.total_km;
  if (map) {
    map.remove();
    map = null;
  }

  $root.innerHTML = `
    <section class="card">
      <div id="map" class="map" role="region" aria-label="Route map"></div>
      <div class="legend">
        ${state.isCustom ? '' : Object.entries(GROUP).map(([k, g]) => `
          <label class="chip"><input type="checkbox" data-filter="${k}" ${filters[k] ? 'checked' : ''}>
            <span class="dot" style="background:${g.colour}"></span>${g.label}</label>`).join('')}
      </div>
    </section>
    <section class="card">
      <h2>Elevation</h2>
      <canvas id="profile" height="150" aria-label="Elevation profile"></canvas>
      <p id="cursor-info" class="muted">Tap the profile to pick a point.</p>
      <div class="actions">
        <label class="inline">Set end of
          <select id="cursor-day">${plan.days.map((_, i) => `<option value="${i}">Day ${i + 1}</option>`).join('')}</select>
        </label>
        <button id="cursor-apply" disabled>Set to this km</button>
      </div>
    </section>`;

  // ---- Map
  map = L.map('map', { scrollWheelZoom: true, preferCanvas: true }).setView([36.3, 127.9], 7);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  const starts = dayStarts(plan);
  const bounds = [];
  plan.days.forEach((d, i) => {
    const a = indexAtKm(route, starts[i]);
    const b = indexAtKm(route, d.end_km);
    const latlngs = route.points.slice(a, b + 1).map((p) => [p[0], p[1]]);
    if (latlngs.length > 1) {
      L.polyline(latlngs, { color: DAY_COLOURS[i % DAY_COLOURS.length], weight: 5, opacity: 0.85 })
        .bindTooltip(`Day ${i + 1}: ${fmtKm(d.end_km - starts[i])} km`)
        .addTo(map);
      bounds.push(...latlngs);
    }
    const endPt = route.points[b];
    L.marker([endPt[0], endPt[1]], {
      icon: L.divIcon({
        className: 'day-pin',
        html: `<span style="background:${DAY_COLOURS[i % DAY_COLOURS.length]}">${i + 1}</span>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
    }).bindTooltip(`End of day ${i + 1} · km ${fmtKm(d.end_km)}`).addTo(map);
  });
  if (bounds.length) map.fitBounds(bounds, { padding: [16, 16] });

  if (!state.isCustom) {
    for (const s of stops) {
      const g = groupOf(s.type);
      if (!g || !filters[g]) continue;
      const colour = GROUP[g].colour;
      const circle = L.circleMarker([s.lat, s.lon], {
        radius: g === 'service' ? 3 : 5,
        color: colour,
        fillColor: colour,
        fillOpacity: 0.9,
        weight: 1,
      }).addTo(map);
      const dayOptions = plan.days.map((_, i) => `<option value="${i}">Day ${i + 1}</option>`).join('');
      circle.bindPopup(`
        <strong>${esc(s.name)}</strong>${s.name_ko && s.name_ko !== s.name ? `<br>${esc(s.name_ko)}` : ''}<br>
        <span class="muted">${esc(s.type)} · km ${fmtKm(s.km)}</span><br>
        <div class="popup-set">
          <select data-popup-day>${dayOptions}</select>
          <button data-popup-set data-km="${s.km}">Set day end</button>
        </div>`);
    }
  }

  // Mark the chosen cursor point
  if (cursorKm !== null) placeCursor(cursorKm);

  map.on('popupopen', (e) => {
    const el = e.popup.getElement();
    el.querySelector('[data-popup-set]')?.addEventListener('click', (ev) => {
      const day = Number(el.querySelector('[data-popup-day]').value);
      setDayEnd(plan, day, Number(ev.currentTarget.dataset.km), total);
      changed();
    });
  });

  $root.querySelectorAll('[data-filter]').forEach((input) => {
    input.addEventListener('change', () => {
      filters[input.dataset.filter] = input.checked;
      renderMap($root);
    });
  });

  // ---- Profile
  drawProfile($root.querySelector('#profile'));
  wireProfile($root.querySelector('#profile'), $root);
  $root.querySelector('#cursor-apply').addEventListener('click', () => {
    if (cursorKm === null) return;
    setDayEnd(plan, Number($root.querySelector('#cursor-day').value), cursorKm, total);
    changed();
  });
  if (cursorKm !== null) updateCursorInfo($root);
}

function placeCursor(km) {
  const { route } = state;
  const p = route.points[indexAtKm(route, km)];
  if (cursorMarker) cursorMarker.remove();
  cursorMarker = L.circleMarker([p[0], p[1]], { radius: 7, color: '#111', fillColor: '#fff', fillOpacity: 1, weight: 3 }).addTo(map);
}

function updateCursorInfo($root) {
  const { route, plan } = state;
  const i = indexAtKm(route, cursorKm);
  const p = route.points[i];
  $root.querySelector('#cursor-info').textContent =
    `km ${fmtKm(cursorKm)} · elevation ${Math.round(route.ele[i])} m · in Day ${dayOfKm(plan, cursorKm) + 1}`;
  $root.querySelector('#cursor-apply').disabled = false;
  $root.querySelector('#cursor-day').value = String(dayOfKm(plan, cursorKm));
  if (map && p) placeCursor(cursorKm);
}

function drawProfile(canvas) {
  const { route, plan, stops } = state;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.parentElement.clientWidth - 2;
  const height = 150;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const c = canvas.getContext('2d');
  c.scale(dpr, dpr);
  const css = getComputedStyle(canvas);
  const ink = css.color || '#222';

  const pad = { l: 44, r: 14, t: 8, b: 20 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const total = route.total_km;
  const maxE = Math.max(...route.ele) * 1.1 + 5;
  const x = (km) => pad.l + (km / total) * plotW;
  const y = (e) => pad.t + plotH - (e / maxE) * plotH;
  profileCtx = { pad, plotW, total };

  // Resupply gaps
  if (!state.isCustom) {
    for (const g of serviceGaps(route, stops, state.plan.gap_km)) {
      c.fillStyle = 'rgba(215,38,61,0.18)';
      c.fillRect(x(g.from), pad.t, x(g.to) - x(g.from), plotH);
    }
  }

  // Day bands
  const starts = dayStarts(plan);
  plan.days.forEach((d, i) => {
    c.fillStyle = DAY_COLOURS[i % DAY_COLOURS.length];
    c.fillRect(x(starts[i]), height - pad.b + 4, Math.max(1, x(d.end_km) - x(starts[i]) - 1), 6);
  });

  // Elevation area
  c.beginPath();
  c.moveTo(x(0), y(0));
  const step = Math.max(1, Math.floor(route.points.length / plotW));
  for (let i = 0; i < route.points.length; i += step) {
    c.lineTo(x(route.km[i]), y(route.ele[i]));
  }
  c.lineTo(x(total), y(route.ele[route.ele.length - 1]));
  c.lineTo(x(total), pad.t + plotH);
  c.lineTo(x(0), pad.t + plotH);
  c.closePath();
  c.fillStyle = 'rgba(128,128,128,0.25)';
  c.fill();
  c.strokeStyle = ink;
  c.lineWidth = 1;
  c.stroke();

  // Axes
  c.fillStyle = ink;
  c.font = '11px system-ui, sans-serif';
  c.textAlign = 'right';
  c.fillText(`${Math.round(maxE)} m`, pad.l - 4, pad.t + 8);
  c.fillText('0', pad.l - 4, pad.t + plotH);
  c.textAlign = 'center';
  for (let km = 0; km <= total - 60; km += 100) {
    c.textAlign = km === 0 ? 'left' : 'center';
    c.fillText(`${km}`, x(km), height - 6);
  }

  // Day end ticks
  c.strokeStyle = ink;
  c.setLineDash([3, 3]);
  plan.days.forEach((d) => {
    c.beginPath();
    c.moveTo(x(d.end_km), pad.t);
    c.lineTo(x(d.end_km), pad.t + plotH);
    c.stroke();
  });
  c.setLineDash([]);

  // Cursor
  if (cursorKm !== null) {
    c.strokeStyle = '#d7263d';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x(cursorKm), pad.t);
    c.lineTo(x(cursorKm), pad.t + plotH);
    c.stroke();
    c.lineWidth = 1;
  }
}

function wireProfile(canvas, $root) {
  const pick = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const px = (ev.clientX ?? ev.touches?.[0]?.clientX) - rect.left;
    const { pad, plotW, total } = profileCtx;
    const km = Math.min(total, Math.max(0, ((px - pad.l) / plotW) * total));
    cursorKm = round1(km);
    drawProfile(canvas);
    updateCursorInfo($root);
  };
  canvas.addEventListener('click', pick);
  window.addEventListener('resize', () => {
    if (canvas.isConnected) drawProfile(canvas);
  }, { once: true });
}
