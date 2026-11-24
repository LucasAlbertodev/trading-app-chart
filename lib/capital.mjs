// Capital.com Public API: CFD de índices (US100, US500, US30, DE40…), materias primas, forex,
// acciones y cripto, con precios en tiempo real por WebSocket.
//
// Credenciales (⚙ Fuentes de datos → Capital.com): el email/login de la cuenta, la API key
// (Settings → API integrations) y la contraseña propia de esa API key. La app de escritorio las
// guarda cifradas con el llavero del sistema (desktop/main.mjs); `npm start` las toma de
// CAPITAL_API_KEY, CAPITAL_IDENTIFIER, CAPITAL_PASSWORD y CAPITAL_ENV (demo|live).
//
// Solo se usan endpoints de lectura (sesión, mercados, precios, ping). Nunca se envían órdenes.

import { parseTf, basePlan, aggregateUtc } from '../public/js/timeframes.js';

const DAY = 86400;
const HOSTS = {
  demo: 'https://demo-api-capital.backend-capital.com',
  live: 'https://api-capital.backend-capital.com',
};
const WS_URL = 'wss://api-streaming-capital.backend-capital.com/connect';
const EPIC = /^[A-Za-z0-9._-]{1,40}$/;

let config = {
  apiKey: process.env.CAPITAL_API_KEY || '',
  identifier: process.env.CAPITAL_IDENTIFIER || '',
  password: process.env.CAPITAL_PASSWORD || '',
  env: process.env.CAPITAL_ENV === 'live' ? 'live' : 'demo',
};
const listeners = new Set();
let session = null; // { cst, token, used, accountId }
let loginPromise = null;
let lastLoginAt = 0;
const infoCache = new Map(); // epic → { name, type, precision }

export function setCapitalConfig(c = {}) {
  config = {
    apiKey: String(c.apiKey || '').trim(),
    identifier: String(c.identifier || '').trim(),
    password: String(c.password || ''),
    env: c.env === 'live' ? 'live' : 'demo',
  };
  session = null;
  loginPromise = null;
  infoCache.clear();
  for (const fn of listeners) { try { fn(); } catch { /* ignore */ } }
}
export const capitalConfigured = () => !!(config.apiKey && config.identifier && config.password);
export const onCapitalConfigChange = (fn) => listeners.add(fn);

const err = (message, status = 502) => Object.assign(new Error(message), { status });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Capital.com da códigos de error; estos son los habituales, en español.
const ERRORS = {
  'error.invalid.details': 'Email/login o contraseña de la API key incorrectos.',
  'error.invalid.api.key': 'La API key no es válida (¿es de la cuenta demo o de la real?).',
  'error.null.api.key': 'Falta la API key.',
  'error.null.client.token': 'La sesión de Capital.com caducó.',
  'error.too-many.requests': 'Capital.com pide menos peticiones; reintentando en breve.',
  'error.not-found.epic': 'Ese instrumento no existe en Capital.com.',
  'error.invalid.from': 'Rango de fechas no válido.',
  'error.invalid.to': 'Rango de fechas no válido.',
  'error.prices.not-found': 'Capital.com no tiene precios para ese período.',
};
const capError = (code, status) => err(ERRORS[code] || `Capital.com: ${code || `HTTP ${status}`}`, status);

// Límites de la API: 10 peticiones/s por usuario y 1 POST /session por segundo.
let nextSlot = 0;
async function slot() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + 120;
  if (at > now) await sleep(at - now);
}

async function login() {
  if (!capitalConfigured()) throw err('Capital.com no está configurado: añade email, API key y contraseña en ⚙ Fuentes de datos.', 401);
  loginPromise ||= (async () => {
    const wait = lastLoginAt + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    lastLoginAt = Date.now();
    const r = await fetch(`${HOSTS[config.env]}/api/v1/session`, {
      method: 'POST',
      headers: { 'X-CAP-API-KEY': config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: config.identifier, password: config.password, encryptedPassword: false }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw capError(body?.errorCode, r.status);
    const cst = r.headers.get('cst'), token = r.headers.get('x-security-token');
    if (!cst || !token) throw err('Capital.com no devolvió los tokens de sesión.', 502);
    session = { cst, token, used: Date.now(), accountId: body?.currentAccountId || '' };
    return session;
  })().finally(() => { loginPromise = null; });
  return loginPromise;
}

async function getSession() {
  // Los tokens valen 10 minutos desde el último uso.
  if (session && Date.now() - session.used < 9 * 60000) return session;
  return login();
}

async function capGet(path, retry = true) {
  const s = await getSession();
  await slot();
  const r = await fetch(HOSTS[config.env] + path, {
    headers: { CST: s.cst, 'X-SECURITY-TOKEN': s.token },
    signal: AbortSignal.timeout(15000),
  });
  s.used = Date.now();
  const body = await r.json().catch(() => null);
  if (r.status === 401 && retry) { session = null; return capGet(path, false); }
  if (r.status === 429 && retry) { await sleep(1500); return capGet(path, false); }
  if (!r.ok) throw capError(body?.errorCode, r.status);
  return body;
}

export async function capitalStatus() {
  if (!capitalConfigured()) return { configured: false, env: config.env };
  try {
    const s = await getSession();
    return { configured: true, ok: true, env: config.env, account: s.accountId };
  } catch (e) {
    return { configured: true, ok: false, env: config.env, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Mercados
// ---------------------------------------------------------------------------

/** Decimales a partir de precios como 21034.5 o 1.08512. */
function decimalsOf(...prices) {
  let d = 0;
  for (const p of prices) {
    if (!Number.isFinite(p)) continue;
    const s = String(p);
    const i = s.indexOf('.');
    if (i >= 0) d = Math.max(d, s.length - i - 1);
  }
  return Math.min(d, 6);
}

const TYPE = { INDICES: 'Index CFD', COMMODITIES: 'Commodity CFD', CURRENCIES: 'Forex CFD', SHARES: 'Stock CFD', CRYPTOCURRENCIES: 'Crypto CFD' };
const CATEGORY = { INDICES: 'cfd', COMMODITIES: 'cfd', CURRENCIES: 'forex', SHARES: 'stocks', CRYPTOCURRENCIES: 'crypto' };

function shapeMarket(m) {
  return {
    epic: m.epic, name: m.instrumentName || m.epic, type: TYPE[m.instrumentType] || m.instrumentType || 'CFD',
    category: CATEGORY[m.instrumentType] || 'cfd', bid: m.bid, offer: m.offer,
    change: Number.isFinite(m.percentageChange) ? m.percentageChange : null, status: m.marketStatus,
  };
}

export async function capitalSearch(q) {
  const term = String(q || '').trim().slice(0, 40);
  if (!term) return [];
  const body = await capGet(`/api/v1/markets?searchTerm=${encodeURIComponent(term)}`);
  return (body.markets || []).slice(0, 25).map(shapeMarket);
}

async function marketInfo(epic) {
  if (infoCache.has(epic)) return infoCache.get(epic);
  const b = await capGet(`/api/v1/markets/${encodeURIComponent(epic)}`);
  const info = {
    name: b.instrument?.name || epic,
    type: b.instrument?.type,
    precision: Number.isFinite(b.snapshot?.decimalPlacesFactor) ? b.snapshot.decimalPlacesFactor : decimalsOf(b.snapshot?.bid, b.snapshot?.offer),
    currency: b.instrument?.currency || '',
  };
  infoCache.set(epic, info);
  return info;
}

// ---------------------------------------------------------------------------
// Velas
// ---------------------------------------------------------------------------

export const CAPITAL_RES = {
  '1m': 'MINUTE', '5m': 'MINUTE_5', '15m': 'MINUTE_15', '30m': 'MINUTE_30',
  '1h': 'HOUR', '4h': 'HOUR_4', '1D': 'DAY', '1W': 'WEEK',
};
const RES_SEC = { MINUTE: 60, MINUTE_5: 300, MINUTE_15: 900, MINUTE_30: 1800, HOUR: 3600, HOUR_4: 14400, DAY: DAY, WEEK: 7 * DAY };

const nyFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
});
function nyOffset(t) {
  const p = Object.fromEntries(nyFmt.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]));
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) / 1000 - Math.floor(t / 60) * 60) / 60) * 60;
}
/** Día de negociación de un instante UTC (el día de los CFD cierra a las 17:00 de Nueva York). */
export const tradingDay = (t) => Math.floor((t + nyOffset(t) + 7 * 3600) / DAY) * DAY;
const monday = (day) => { const d = day / DAY; return (d - ((((d + 3) % 7) + 7) % 7)) * DAY; };

/** Fecha (etiqueta) de una vela diaria/semanal de Capital.com: empiece a las 00:00 UTC o la tarde anterior. */
function candleLabel(t, res) {
  const day = Math.floor((t + DAY / 2) / DAY) * DAY;
  return res === 'WEEK' ? monday(day) : day;
}

const iso = (t) => new Date(t * 1000).toISOString().slice(0, 19);
const num = (p) => (Number.isFinite(p?.bid) ? p.bid : Number.isFinite(p?.ask) ? p.ask : NaN); // precio bid, como la plataforma

async function fetchPrices(epic, res, beforeUtc) {
  const q = new URLSearchParams({ resolution: res, max: '1000' });
  if (beforeUtc != null) {
    q.set('to', iso(beforeUtc - 1));
    q.set('from', iso(beforeUtc - 1000 * RES_SEC[res]));
  }
  const body = await capGet(`/api/v1/prices/${encodeURIComponent(epic)}?${q}`);
  return (body.prices || []).map((p) => ({
    time: Math.floor(Date.parse(`${p.snapshotTimeUTC}Z`) / 1000),
    open: num(p.openPrice), high: num(p.highPrice), low: num(p.lowPrice), close: num(p.closePrice),
    volume: p.lastTradedVolume || 0,
  })).filter((b) => Number.isFinite(b.time) && Number.isFinite(b.close)).sort((a, b) => a.time - b.time);
}

/**
 * Velas de un epic. before: tiempo (UTC para intradía, fecha para D/W/M) de la primera barra que ya
 * tiene el gráfico. Devuelve { meta, bars, full }; full = puede haber más historia.
 */
export async function capitalCandles(epic, tfId, before = null, want = null) {
  if (!EPIC.test(epic)) throw err('Instrumento no válido', 400);
  const tf = parseTf(tfId);
  if (!tf) throw err('Temporalidad no válida', 400);
  if (before != null && !(before > 315532800 && before < Date.now() / 1000 + 7 * DAY)) throw err('Fecha no válida', 400);
  const plan = basePlan(tf, 'capital');
  const res = plan.native;
  const info = await marketInfo(epic).catch(() => null);

  let raw = [];
  let full = true;
  if (want) {
    const q = new URLSearchParams({ resolution: res, max: String(Math.min(1000, Math.ceil(want * plan.factor) + plan.factor)) });
    const body = await capGet(`/api/v1/prices/${encodeURIComponent(epic)}?${q}`);
    raw = (body.prices || []).map((p) => ({
      time: Math.floor(Date.parse(`${p.snapshotTimeUTC}Z`) / 1000),
      open: num(p.openPrice), high: num(p.highPrice), low: num(p.lowPrice), close: num(p.closePrice), volume: p.lastTradedVolume || 0,
    })).filter((b) => Number.isFinite(b.close)).sort((a, b) => a.time - b.time);
    full = false;
  } else {
    // Más páginas cuando la temporalidad se arma agrupando (45m de 15m, M de días).
    const pages = before == null ? Math.min(3, Math.max(1, Math.ceil(plan.factor / 3))) : Math.min(2, plan.factor);
    let end = before == null ? null : (tf.daily ? before - DAY / 2 : before);
    for (let k = 0, empty = 0; k < pages + empty && empty < 4; k++) {
      let page;
      try { page = await fetchPrices(epic, res, end); } catch (e) {
        if (raw.length) break;
        if (e.status === 404 || /período|fechas/.test(e.message)) { if (end == null) throw e; page = []; } else throw e;
      }
      if (!page.length) {
        if (end == null) break;
        empty++; // fin de semana o festivo: retrocede otro bloque
        end -= 1000 * RES_SEC[res];
        continue;
      }
      raw = page.concat(raw.filter((b) => b.time > page[page.length - 1].time));
      end = page[0].time;
    }
    if (!raw.length && before != null) full = false;
  }

  // Hora UTC a la que empiezan las velas diarias de Capital.com (para que los ticks caigan en la misma barra).
  let dayStart = null;
  if (tf.daily && raw.length) {
    const counts = new Map();
    for (const b of raw) { const s = ((b.time % DAY) + DAY) % DAY; counts.set(s, (counts.get(s) || 0) + 1); }
    dayStart = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  }
  if (tf.daily) {
    raw = raw.map((b) => ({ ...b, time: candleLabel(b.time, res) }));
    if (before != null) raw = raw.filter((b) => b.time < before);
  } else if (before != null) raw = raw.filter((b) => b.time < before);

  let bars;
  if (tf.unit === 'M') {
    const groups = new Map();
    for (const b of raw) {
      const d = new Date(b.time * 1000);
      const k = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
      const g = groups.get(k);
      if (!g) groups.set(k, { ...b, time: k });
      else { g.high = Math.max(g.high, b.high); g.low = Math.min(g.low, b.low); g.close = b.close; g.volume += b.volume; }
    }
    bars = [...groups.values()];
  } else bars = plan.agg && !tf.daily ? aggregateUtc(raw, tf) : raw;

  return {
    meta: {
      symbol: epic,
      name: info?.name || epic,
      exchange: `Capital.com${config.env === 'demo' ? ' (demo)' : ''}`,
      currency: info?.currency || '',
      type: info?.type === 'CURRENCIES' ? 'forex' : 'cfd',
      precision: info?.precision ?? decimalsOf(...bars.slice(-20).map((b) => b.close)),
      dayStart,
    },
    bars,
    full,
  };
}

// ---------------------------------------------------------------------------
// Cotizaciones (watchlist, alertas)
// ---------------------------------------------------------------------------

export async function capitalQuotes(epics) {
  const list = epics.filter((s) => EPIC.test(s)).slice(0, 50);
  if (!list.length) return [];
  const body = await capGet(`/api/v1/markets?epics=${list.map(encodeURIComponent).join(',')}`);
  return (body.marketDetails || body.markets || []).map((m) => {
    const inst = m.instrument || m, snap = m.snapshot || m;
    const price = Number.isFinite(snap.bid) ? snap.bid : snap.offer;
    const pct = Number.isFinite(snap.percentageChange) ? snap.percentageChange : null;
    return {
      symbol: inst.epic, price, change: pct,
      prevClose: pct != null && Number.isFinite(price) ? price / (1 + pct / 100) : null,
      precision: Number.isFinite(snap.decimalPlacesFactor) ? snap.decimalPlacesFactor : decimalsOf(snap.bid, snap.offer),
      name: inst.name || inst.instrumentName || inst.epic,
    };
  });
}

// ---------------------------------------------------------------------------
// Streaming: un WebSocket para toda la app (máx. 40 instrumentos, según Capital.com)
// ---------------------------------------------------------------------------

export class CapitalStreamer {
  constructor() {
    this.clients = new Set();
    this.key = '';
    this.ws = null;
    this.timer = null;
    this.pinger = null;
    this.retry = 0;
    this.seq = 0;
    this.gen = 0; // cada cambio de lista invalida las conexiones en curso
    onCapitalConfigChange(() => this.restart());
  }

  attach(c) { this.clients.add(c); this.schedule(); }
  detach(c) { this.clients.delete(c); this.schedule(); }
  restart() { this.key = ''; this.schedule(); }
  schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.sync(), 250); }

  sync() {
    const all = new Set();
    for (const c of this.clients) for (const s of c.symbols) all.add(s);
    const key = [...all].sort().slice(0, 40).join(',');
    if (key === this.key && this.ws) return;
    this.key = key;
    this.close();
    const gen = ++this.gen;
    if (key && capitalConfigured()) this.connect(key, gen);
  }

  close() {
    clearInterval(this.pinger);
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch { /* ignore */ }
  }

  async connect(key, gen) {
    let s;
    try { s = await getSession(); } catch { if (gen === this.gen) this.later(key, gen); return; }
    if (gen !== this.gen || this.ws) return;
    const ws = new WebSocket(WS_URL);
    this.ws = ws;
    const send = (destination, payload) => ws.send(JSON.stringify({
      destination, correlationId: String(++this.seq), cst: s.cst, securityToken: s.token, ...(payload ? { payload } : {}),
    }));
    ws.onopen = () => {
      this.retry = 0;
      send('marketData.subscribe', { epics: key.split(',') });
      // La sesión del WebSocket dura 10 minutos: ping cada 4 (también mantiene viva la REST).
      this.pinger = setInterval(() => { try { send('ping'); s.used = Date.now(); } catch { /* cerrado */ } }, 4 * 60000);
    };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString()); } catch { return; }
      if (m.destination !== 'quote' || !m.payload) return;
      const p = m.payload;
      const price = Number.isFinite(p.bid) ? p.bid : p.ofr;
      if (!Number.isFinite(price)) return;
      const tick = { s: p.epic, p: price, b: p.bid, a: p.ofr, t: p.timestamp || Date.now() };
      for (const c of this.clients) if (c.symbols.has(tick.s)) c.send(tick);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      clearInterval(this.pinger);
      this.ws = null;
      session = null; // por si la sesión caducó: se vuelve a abrir
      if (gen === this.gen) this.later(key, gen);
    };
    ws.onerror = () => {};
  }

  later(key, gen) {
    const wait = Math.min(1000 * 2 ** this.retry++, 30000);
    setTimeout(() => { if (!this.ws && gen === this.gen && key) this.connect(key, gen); }, wait);
  }
}
