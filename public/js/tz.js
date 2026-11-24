// Zona horaria del reloj y de los gráficos (CFD de brókers y cripto). '' = la del sistema.
// Funciones puras salvo getTz/setTz (localStorage): el servidor y los tests también las usan.

const KEY = 'wickline.chartTz';

export function getTz() {
  try { return JSON.parse(localStorage.getItem(KEY)) || ''; } catch { return ''; }
}
export function setTz(tz) {
  try { localStorage.setItem(KEY, JSON.stringify(tz || '')); } catch { /* ignore */ }
}

const fmtCache = new Map();
function partsFmt(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Segundos a sumar a UTC para tener la hora de tz en el instante t (segundos UTC). */
export function tzOffsetAt(tz, t = Date.now() / 1000) {
  if (!tz) return -new Date(t * 1000).getTimezoneOffset() * 60;
  if (tz === 'UTC' || tz === 'Etc/UTC') return 0;
  try {
    const p = Object.fromEntries(partsFmt(tz).formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) / 1000;
    return Math.round((asUtc - Math.floor(t / 60) * 60) / 60) * 60;
  } catch {
    return -new Date(t * 1000).getTimezoneOffset() * 60;
  }
}

/** "UTC−05:00", "UTC+05:30", "UTC". */
export function offsetLabel(sec) {
  if (!sec) return 'UTC';
  const s = sec < 0 ? '−' : '+';
  const m = Math.abs(sec) / 60;
  return `UTC${s}${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "America/Argentina/Buenos_Aires" → "Buenos Aires (America)". */
export function cityName(tz) {
  const parts = tz.split('/');
  const city = parts[parts.length - 1].replace(/_/g, ' ');
  return parts.length > 1 ? `${city} (${parts[0]})` : city;
}

/**
 * Todas las zonas horarias IANA que conoce el sistema, con su desfase actual, ordenadas de
 * UTC−12 a UTC+14: [{ tz, offset, label, city }]. Sin las Etc/GMT±N (nombres con el signo invertido).
 */
export function tzList(now = Date.now() / 1000) {
  let names = [];
  try { names = Intl.supportedValuesOf('timeZone'); } catch { names = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo']; }
  const list = names.filter((n) => !n.startsWith('Etc/') && n !== 'UTC').map((tz) => {
    const offset = tzOffsetAt(tz, now);
    return { tz, offset, city: cityName(tz), label: `(${offsetLabel(offset)}) ${cityName(tz)}` };
  });
  list.sort((a, b) => a.offset - b.offset || a.city.localeCompare(b.city));
  return [{ tz: 'UTC', offset: 0, city: 'UTC', label: '(UTC) UTC' }, ...list];
}

/** Hora del reloj en tz: "14:32:05". */
export function clockText(tz, date = new Date(), locale = undefined) {
  const opts = { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' };
  if (tz) opts.timeZone = tz;
  try { return date.toLocaleTimeString(locale, opts); } catch { return date.toLocaleTimeString(locale, { ...opts, timeZone: undefined }); }
}
