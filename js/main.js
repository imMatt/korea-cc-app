import { state, setRouteRaw, loadSavedCustomRoute } from './state.js';
import { renderDays } from './views/days.js';
import { renderMap } from './views/map.js';
import { renderStops } from './views/stops.js';
import { renderLive, stopLive } from './views/live.js';
import { renderSettings } from './views/settings.js';

const VIEWS = {
  days: renderDays,
  map: renderMap,
  stops: renderStops,
  live: renderLive,
  settings: renderSettings,
};

const $view = document.getElementById('view');
let current = null;

function show(name) {
  if (!VIEWS[name]) name = 'days';
  if (current && current !== name && current === 'live') stopLive();
  current = name;
  document.querySelectorAll('nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.tab === name);
  });
  $view.innerHTML = '';
  VIEWS[name]($view);
}

state.onChange = () => {
  if (current) show(current);
};

window.addEventListener('hashchange', () => show(location.hash.slice(1)));

async function boot() {
  try {
    const custom = loadSavedCustomRoute();
    if (custom) {
      setRouteRaw(custom, true);
    } else {
      const [route, stops] = await Promise.all([
        fetch('data/route.json').then((r) => r.json()),
        fetch('data/stops.json').then((r) => r.json()),
      ]);
      state.stops = stops.stops;
      setRouteRaw(route, false);
    }
    show(location.hash.slice(1) || 'days');
  } catch (err) {
    $view.innerHTML = `<div class="card warn"><strong>Could not load route data.</strong>
      <p>${err.message}</p>
      <p>If you opened this file directly, serve the folder instead (for example <code>python3 -m http.server</code>).</p></div>`;
  }
}

boot();
