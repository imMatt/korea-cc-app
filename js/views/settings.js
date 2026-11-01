import { state, changed, defaultPlan, importPlan, saveCustomRoute, clearCustomRoute, setRouteRaw, round1 } from '../state.js';
import { parseGpx, rawRouteFromPoints } from '../geo.js';
import { esc } from '../util.js';

export function renderSettings($root) {
  const { plan, route } = state;
  $root.innerHTML = `
    <section class="card">
      <h2>Trip settings</h2>
      <div class="form-grid">
        <label class="field">Day 0 date (first ride) <input type="date" data-set="start_date" value="${esc(plan.start_date)}"></label>
        <label class="field">Depart each morning <input type="time" data-set="depart_time" value="${esc(plan.depart_time)}"></label>
        <label class="field">Average moving speed (km/h) <input type="number" step="0.5" min="5" data-set="avg_kmh" value="${plan.avg_kmh}"></label>
        <label class="field">Climbing rate (m/h) <input type="number" step="25" min="50" data-set="climb_m_per_h" value="${plan.climb_m_per_h}"></label>
        <label class="field">Daily limit (km) <input type="number" step="5" min="10" data-set="max_day_km" value="${plan.max_day_km}"></label>
        <label class="field">Flag resupply gaps of at least (km) <input type="number" step="1" min="5" data-set="gap_km" value="${plan.gap_km}"></label>
      </div>
      <p class="muted small">Ride time = distance ÷ speed + climb ÷ climbing rate. Breaks aren't included, so add some slack.</p>
    </section>

    <section class="card">
      <h2>Route</h2>
      <p>Currently: <strong>${esc(route.name)}</strong> · ${route.total_km.toFixed(1)} km${state.isCustom ? ' (imported GPX)' : ' (bundled)'}</p>
      <label class="field">Import a different GPX
        <input type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" id="gpx-file">
      </label>
      ${state.isCustom ? '<div class="actions"><button id="restore-route">Restore bundled route</button></div>' : ''}
      <p class="muted small">An imported route is stored on this device only. Stops and resupply gaps come from the bundled route, so they're hidden for imports.</p>
    </section>

    <section class="card">
      <h2>Backup</h2>
      <p class="muted small">Your plan is saved in this browser. Export it to keep a copy or move it to another phone.</p>
      <div class="actions">
        <button id="export-plan">Export plan (JSON)</button>
        <label class="button-like">Import plan
          <input type="file" accept="application/json,.json" id="import-plan" hidden>
        </label>
        <button id="reset-plan" class="danger">Reset plan</button>
      </div>
      <p id="settings-msg" class="muted"></p>
    </section>`;

  const msg = (text) => ($root.querySelector('#settings-msg').textContent = text);

  $root.querySelectorAll('[data-set]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.dataset.set;
      const v = input.type === 'number' ? Number(input.value) : input.value;
      if (input.type === 'number' && !(v > 0)) return;
      if (input.type === 'date' || input.type === 'time') {
        if (!input.value) return; // keep the previous valid value
      }
      state.plan[key] = v;
      changed();
    });
  });

  $root.querySelector('#gpx-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { name, pts } = parseGpx(await file.text());
      const raw = rawRouteFromPoints(name, pts);
      saveCustomRoute(raw);
      setRouteRaw(raw, true);
      state.stops = [];
      changed();
    } catch (err) {
      msg(err.message);
    }
  });

  $root.querySelector('#restore-route')?.addEventListener('click', async () => {
    clearCustomRoute();
    const [raw, stops] = await Promise.all([
      fetch('data/route.json').then((r) => r.json()),
      fetch('data/stops.json').then((r) => r.json()),
    ]);
    state.stops = stops.stops;
    setRouteRaw(raw, false);
    changed();
  });

  $root.querySelector('#export-plan').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state.plan, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'korea-cc-plan.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $root.querySelector('#import-plan').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      importPlan(JSON.parse(await file.text()));
      changed();
    } catch (err) {
      msg(`Could not import: ${err.message}`);
    }
  });

  $root.querySelector('#reset-plan').addEventListener('click', () => {
    if (!confirm('Reset the plan to an even 9-day split? Notes and bookings will be lost.')) return;
    state.plan = defaultPlan(route.total_km);
    changed();
  });
}
