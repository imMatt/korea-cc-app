// Sunrise/sunset from the NOAA-style approximation (Wikipedia "Sunrise equation").
// Accurate to a few minutes, which is enough for planning.

const RAD = Math.PI / 180;
const J2000 = 2451545.0;
const UNIX_EPOCH_JD = 2440587.5;

// dateStr: 'YYYY-MM-DD' (calendar date at the location). lon: east positive.
// Returns { rise, set } as Date objects, or null during polar day/night.
export function sunTimes(dateStr, lat, lon) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const jdNoon = Date.UTC(y, m - 1, d, 12) / 86400000 + UNIX_EPOCH_JD;
  const n = Math.round(jdNoon - J2000 + 0.0008);
  const jStar = n - lon / 360; // east-positive longitude
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const Mr = M * RAD;
  const C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr);
  const lambda = ((M + C + 180 + 102.9372) % 360) * RAD;
  const jTransit = J2000 + jStar + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * lambda);
  const sinDec = Math.sin(lambda) * Math.sin(23.4397 * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  const phi = lat * RAD;
  const cosW = (Math.sin(-0.833 * RAD) - Math.sin(phi) * sinDec) / (Math.cos(phi) * cosDec);
  if (cosW < -1 || cosW > 1) return null;
  const w = Math.acos(cosW) / RAD;
  const toDate = (j) => new Date((j - UNIX_EPOCH_JD) * 86400000);
  return { rise: toDate(jTransit - w / 360), set: toDate(jTransit + w / 360), noon: toDate(jTransit) };
}
