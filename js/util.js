export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const fmtKm = (v) => (Math.round(v * 10) / 10).toFixed(1);
export const fmtM = (v) => `${Math.round(v)} m`;

// hours (decimal) -> "3h 05m"
export function fmtHours(h) {
  if (!isFinite(h) || h < 0) return '–';
  const mins = Math.round(h * 60);
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

// Dates in Korea time (UTC+9). Trip dates are calendar dates, so format in UTC to avoid shifts.
export function fmtDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export const fmtKst = (date) =>
  date ? date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }) : '–';
