// OANDA v20: CFD de índices (NAS100_USD, SPX500_USD, US30_USD, DE30_EUR…), metales, materias
// primas y forex, con precios en tiempo real por streaming.
//
// Necesita un token personal de la API de OANDA (gratis con una cuenta demo "practice":
// https://www.oanda.com → Mi cuenta → Gestionar acceso API). El token vive solo en este
// ordenador: la app de escritorio lo guarda cifrado con el llavero del sistema
// (desktop/main.mjs) y `npm start` lo toma de OANDA_TOKEN / OANDA_ENV.
//
// Solo se usan endpoints de lectura (cuentas, instrumentos, velas, precios). Nunca se envían órdenes.

import { parseTf, basePlan, aggregateUtc } from '../public/js/timeframes.js';

const DAY = 86400;
const HOSTS = {
  practice: { rest: 'https://api-fxpractice.oanda.com', stream: 'https://stream-fxpractice.oanda.com' },
  live: { rest: 'https://api-fxtrade.oanda.com', stream: 'https://stream-fxtrade.oanda.com' },
};

let config = {
  token: process.env.OANDA_TOKEN || '',
  env: process.env.OANDA_ENV === 'live' ? 'live' : 'practice',
};
let accountPromise = null;
let instrumentsPromise = null;
const listeners = new Set();

export function setOandaConfig({ token = '', env = 'practice' } = {}) {
  config = { token: String(token || '').trim(), env: env === 'live' ? 'live' : 'practice' };
  accountPromise = null;
  instrumentsPromise = null;
  prevCloseCache.clear();
  for (const fn of listeners) { try { fn(); } catch { /* ignore */ } }
}
export const oandaConfigured = () => !!config.token;
export const oandaEnv = () => config.env;
export const onOandaConfigChange = (fn) => listeners.add(fn);

function err(message, status = 502) {
  return Object.assign(new Error(message), { status });
}

async function oandaGet(path, { stream = false, signal } = {}) {
  if (!config.token) throw err('OANDA no está configurado: añade tu token en ⚙ Fuentes de datos.', 401);
  const base = HOSTS[config.env][stream ? 'stream' : 'rest'];
  const r = await fetch(base + path, {
    headers: { Authorization: `Bearer ${config.token}`, 'Accept-Datetime-Format': 'UNIX' },
    signal: signal || AbortSignal.timeout(15000),
  });
  if (stream) {
    if (!r.ok) throw err(`OANDA: HTTP ${r.status}`, r.status);
    return r;
  }
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = body?.errorMessage || `HTTP ${r.status}`;
    throw err(r.status === 401 ? `OANDA rechazó el token (${msg}). ¿Es de la cuenta ${config.env === 'live' ? 'real' : 'demo'}?` : `OANDA: ${msg}`, r.status);
  }
  return body;
}

function accountId() {
  accountPromise ||= oandaGet('/v3/accounts').then((b) => {
    const id = b.accounts?.[0]?.id;
    if (!id) throw err('El token no tiene ninguna cuenta OANDA.', 404);
    return id;
  }).catch((e) => { accountPromise = null; throw e; });
  return accountPromise;
}

/** Instrumentos de la cuenta: [{ name, displayName, type, precision }]. */
export function oandaInstruments() {
  instrumentsPromise ||= (async () => {
    const id = await accountId();
    const b = await oandaGet(`/v3/accounts/${id}/instruments`);
    return (b.instruments || []).map((i) => ({
      name: i.name, displayName: i.displayName, type: i.type, precision: i.displayPrecision ?? 2,
    }));
  })().catch((e) => { instrumentsPromise = null; throw e; });
  return instrumentsPromise;
}

async function instrumentInfo(name) {
  return (await oandaInstruments()).find((i) => i.name === name) || null;
}

export async function oandaStatus() {
  if (!config.token) return { configured: false, env: config.env };
  try {
    const id = await accountId();
    const list = await oandaInstruments();
    return { configured: true, ok: true, env: config.env, account: id, instruments: list.length };
  } catch (e) {
    return { configured: true, ok: false, env: config.env, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Velas
// ---------------------------------------------------------------------------

export const OANDA_GRAN = {
  '1m': 'M1', '2m': 'M2', '4m': 'M4', '5m': 'M5', '10m': 'M10', '15m': 'M15', '30m': 'M30',
  '1h': 'H1', '2h': 'H2', '3h': 'H3', '4h': 'H4', '6h': 'H6', '8h': 'H8', '12h': 'H12',
  '1D': 'D', '1W': 'W', '1M': 'M',
};

/** Diferencia UTC → hora de Nueva York (segundos, negativa) en el instante t. */
const nyFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
});
export function nyOffset(t) {
  const p = Object.fromEntries(nyFmt.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) / 1000;
  return Math.round((asUtc - Math.floor(t / 60) * 60) / 60) * 60;
}

/**
 * Día de negociación (00:00 UTC de la fecha) al que pertenece el instante t: los CFD y el forex
 * cierran el día a las 17:00 de Nueva York, como en TradingView/MetaTrader con OANDA.
 */
export function tradingDay(t) {
  return Math.floor((t + nyOffset(t) + 7 * 3600) / DAY) * DAY;
}

/** Barra diaria/semanal/mensual (fecha de la etiqueta) de un instante UTC t. */
export function dailyBucket(t, unit) {
  const day = tradingDay(t);
  if (unit === 'W') { const d = day / DAY; return (d - ((((d + 3) % 7) + 7) % 7)) * DAY; } // lunes
  if (unit === 'M') { const d = new Date(day * 1000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000; }
  return day;
}

/**
 * Velas de un instrumento. tf: id de temporalidad (cualquiera: 45m sale de 15m). before: tiempo
 * de la primera barra que ya tiene el gráfico (UTC para intradía, fecha para D/W/M), para cargar
 * las anteriores. Devuelve { meta, bars, full }, barras intradía en UTC.
 */
export async function oandaCandles(instrument, tfId, before = null, want = null) {
  if (!/^[A-Z0-9]{2,12}_[A-Z0-9]{2,12}$/.test(instrument)) throw err('Instrumento no válido', 400);
  const tf = parseTf(tfId);
  if (!tf) throw err('Temporalidad no válida', 400);
  const plan = basePlan(tf, 'oanda');
  const q = new URLSearchParams({
    price: 'M', granularity: plan.native,
    count: String(want ? Math.min(5000, Math.ceil(want * plan.factor) + plan.factor) : 5000),
    dailyAlignment: '17', alignmentTimezone: 'America/New_York', weeklyAlignment: 'Sunday',
  });
  if (before != null && !(before > 315532800 && before < Date.now() / 1000 + 7 * DAY)) throw err('Fecha no válida', 400);
  if (before != null) {
    // Para D/W/M la etiqueta es una fecha; la vela empieza la tarde anterior (17:00 NY).
    const to = tf.daily ? before - DAY / 2 : before;
    q.set('to', String(to));
  }
  const [info, body] = await Promise.all([
    instrumentInfo(instrument).catch(() => null),
    oandaGet(`/v3/instruments/${instrument}/candles?${q}`),
  ]);
  let raw = (body.candles || []).map((c) => {
    const t = Math.floor(Number(c.time));
    return {
      time: tf.daily ? dailyBucket(t, plan.base.unit) : t,
      open: +c.mid.o, high: +c.mid.h, low: +c.mid.l, close: +c.mid.c, volume: c.volume || 0,
    };
  });
  if (before != null) raw = raw.filter((b) => b.time < before);
  const bars = plan.agg && !tf.daily ? aggregateUtc(raw, tf) : raw;
  return {
    meta: {
      symbol: instrument,
      name: info?.displayName || instrument.replace('_', ' / '),
      exchange: `OANDA CFD${config.env === 'practice' ? ' (demo)' : ''}`,
      currency: instrument.split('_')[1] || '',
      type: info?.type === 'CURRENCY' ? 'forex' : 'cfd',
      precision: info?.precision ?? 2,
    },
    bars,
    full: !want && (body.candles || []).length >= 4900,
  };
}

// ---------------------------------------------------------------------------
// Cotizaciones (watchlist, alertas)
// ---------------------------------------------------------------------------

const prevCloseCache = new Map(); // instrumento → { t, close }

async function prevClose(instrument) {
  const hit = prevCloseCache.get(instrument);
  if (hit && Date.now() - hit.t < 5 * 60000) return hit.close;
  const q = new URLSearchParams({ price: 'M', granularity: 'D', count: '3', dailyAlignment: '17', alignmentTimezone: 'America/New_York' });
  const body = await oandaGet(`/v3/instruments/${instrument}/candles?${q}`);
  const done = (body.candles || []).filter((c) => c.complete);
  const close = done.length ? +done[done.length - 1].mid.c : null;
  prevCloseCache.set(instrument, { t: Date.now(), close });
  return close;
}

export async function oandaQuotes(instruments) {
  const list = instruments.filter((s) => /^[A-Z0-9]{2,12}_[A-Z0-9]{2,12}$/.test(s)).slice(0, 100);
  if (!list.length) return [];
  const id = await accountId();
  const [body, infos, closes] = await Promise.all([
    oandaGet(`/v3/accounts/${id}/pricing?instruments=${list.join(',')}`),
    oandaInstruments().catch(() => []),
    Promise.all(list.map((s) => prevClose(s).catch(() => null))),
  ]);
  return (body.prices || []).map((p) => {
    const price = mid(p);
    const i = list.indexOf(p.instrument);
    const pc = closes[i];
    const info = infos.find((x) => x.name === p.instrument);
    return {
      symbol: p.instrument, price, prevClose: pc, change: pc ? ((price - pc) / pc) * 100 : null,
      precision: info?.precision ?? 2, name: info?.displayName || p.instrument,
    };
  });
}

function mid(p) {
  const b = +p.bids?.[0]?.price, a = +p.asks?.[0]?.price;
  if (Number.isFinite(b) && Number.isFinite(a)) return (b + a) / 2;
  return Number.isFinite(b) ? b : +p.closeoutBid || +p.closeoutAsk || NaN;
}

// ---------------------------------------------------------------------------
// Streaming: una sola conexión a OANDA para todos los gráficos y listas de la app
// ---------------------------------------------------------------------------

export class OandaStreamer {
  constructor() {
    this.clients = new Set();
    this.key = '';
    this.ctrl = null;
    this.timer = null;
    this.retry = 0;
    onOandaConfigChange(() => this.restart());
  }

  attach(c) { this.clients.add(c); this.schedule(); }
  detach(c) { this.clients.delete(c); this.schedule(); }
  restart() { this.key = ''; this.schedule(); }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(), 250);
  }

  sync() {
    const all = new Set();
    for (const c of this.clients) for (const s of c.symbols) all.add(s);
    const key = [...all].sort().join(',');
    if (key === this.key && this.ctrl) return;
    this.key = key;
    this.ctrl?.abort();
    this.ctrl = null;
    if (key && config.token) this.connect(key);
  }

  async connect(key) {
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    try {
      const id = await accountId();
      const res = await oandaGet(`/v3/accounts/${id}/pricing/stream?instruments=${key}&snapshot=true`, { stream: true, signal: ctrl.signal });
      this.retry = 0;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let watchdog = null;
      const pet = () => { clearTimeout(watchdog); watchdog = setTimeout(() => ctrl.abort(), 20000); }; // OANDA manda latidos cada 5 s
      pet();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        pet();
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let m;
          try { m = JSON.parse(line); } catch { continue; }
          if (m.type !== 'PRICE') continue;
          const p = mid(m);
          if (!Number.isFinite(p)) continue;
          const tick = { s: m.instrument, p, b: +m.bids?.[0]?.price, a: +m.asks?.[0]?.price, t: Math.round(Number(m.time) * 1000), ok: m.tradeable !== false };
          for (const c of this.clients) if (c.symbols.has(tick.s)) c.send(tick);
        }
      }
      clearTimeout(watchdog);
    } catch { /* cortado o sin red: se reintenta */ }
    if (this.ctrl !== ctrl) return; // reemplazado por otra conexión
    this.ctrl = null;
    const wait = Math.min(1000 * 2 ** this.retry++, 30000);
    setTimeout(() => { if (!this.ctrl && this.key === key) this.connect(key); }, wait);
  }
}
