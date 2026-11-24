// Tests de los brókers CFD (lib/capital.mjs, lib/oanda.mjs) contra APIs simuladas, y de las
// protecciones del servidor para sus endpoints (/api/capital/*, /api/oanda/*).
// Sin red: fetch y WebSocket se reemplazan. Run: node test/brokers.test.mjs
import assert from 'node:assert/strict';
import http from 'node:http';

let failed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.stack.split('\n').slice(0, 3).join('\n       ')}`); }
};
const utc = (s) => Date.parse(`${s}Z`) / 1000;
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// API simulada de Capital.com
// ---------------------------------------------------------------------------
const calls = [];
let logins = 0;
let nowBars = utc('2026-11-23T16:00:00');
const realFetch = globalThis.fetch;
const H = (o) => ({ get: (k) => o[k.toLowerCase()] ?? null });
const json = (b, status = 200, headers = {}) => ({ ok: status < 400, status, headers: H(headers), json: async () => b });

function capitalApi(u, opt) {
  if (u.pathname === '/api/v1/session') {
    const b = JSON.parse(opt.body);
    if (opt.headers['X-CAP-API-KEY'] !== 'KEY') return json({ errorCode: 'error.invalid.api.key' }, 401);
    if (b.password !== 'pw' || b.encryptedPassword !== false) return json({ errorCode: 'error.invalid.details' }, 401);
    logins++;
    return json({ currentAccountId: 'ACC1' }, 200, { cst: `C${logins}`, 'x-security-token': 'T' });
  }
  if (!String(opt.headers?.CST || '').startsWith('C')) return json({ errorCode: 'error.null.client.token' }, 401);
  if (u.pathname === '/api/v1/markets/US100') {
    return json({ instrument: { name: 'US Tech 100', type: 'INDICES', currency: 'USD' }, snapshot: { bid: 21000.5, offer: 21001.5, decimalPlacesFactor: 1 } });
  }
  if (u.pathname === '/api/v1/markets' && u.searchParams.get('searchTerm')) {
    return json({ markets: [{ epic: 'US100', instrumentName: 'US Tech 100', instrumentType: 'INDICES', bid: 21000, offer: 21001, percentageChange: 0.5 }] });
  }
  if (u.pathname === '/api/v1/markets') {
    return json({ marketDetails: [{ instrument: { epic: 'US100', name: 'US Tech 100' }, snapshot: { bid: 21105, offer: 21106, percentageChange: 0.5, decimalPlacesFactor: 1 } }] });
  }
  if (u.pathname.startsWith('/api/v1/prices/')) {
    const res = u.searchParams.get('resolution');
    const step = { MINUTE: 60, MINUTE_5: 300, MINUTE_15: 900, MINUTE_30: 1800, HOUR: 3600, HOUR_4: 14400, DAY: 86400, WEEK: 604800 }[res];
    const max = +u.searchParams.get('max') || 10;
    const n = Math.min(max, 12);
    const to = u.searchParams.get('to') ? utc(u.searchParams.get('to')) + 1 : nowBars;
    // Velas diarias a las 22:00 UTC (17:00 NY en invierno), intradía alineadas a su resolución.
    const last = res === 'DAY' ? Math.floor((to - 79200) / 86400) * 86400 + 79200 : Math.floor(to / step) * step - step;
    const p = (v) => ({ bid: v, ask: v + 1 });
    return json({ prices: Array.from({ length: n }, (_, i) => {
      const t = last - (n - 1 - i) * step;
      return { snapshotTimeUTC: new Date(t * 1000).toISOString().slice(0, 19), openPrice: p(21000), highPrice: p(21010 + i), lowPrice: p(20990), closePrice: p(21000 + i), lastTradedVolume: 5 };
    }) });
  }
  return json({ errorCode: 'error.not-found.epic' }, 404);
}

globalThis.fetch = async (url, opt = {}) => {
  const u = new URL(String(url));
  if (u.hostname === '127.0.0.1') return realFetch(url, opt);
  calls.push(`${opt.method || 'GET'} ${u.host}${u.pathname}`);
  if (u.host.includes('capital')) return capitalApi(u, opt);
  throw new Error(`unexpected ${u}`);
};

const sockets = [];
globalThis.WebSocket = class {
  constructor(url) {
    this.url = url;
    this.sent = [];
    sockets.push(this);
    setTimeout(() => {
      this.onopen?.();
      this.onmessage?.({ data: JSON.stringify({ status: 'OK', destination: 'quote', payload: { epic: 'US100', bid: 21002.3, ofr: 21003.3, timestamp: 1763913600000 } }) });
      this.onmessage?.({ data: JSON.stringify({ status: 'OK', destination: 'quote', payload: { epic: 'OTHER', bid: 1, ofr: 2, timestamp: 1 } }) });
    }, 5);
  }
  send(x) { this.sent.push(JSON.parse(x)); }
  close() { this.closed = true; }
};

const cap = await import('../lib/capital.mjs');

console.log('Capital.com');
await test('sin configurar: error claro, sin llamadas a la red', async () => {
  cap.setCapitalConfig({});
  const st = await cap.capitalStatus();
  assert.equal(st.configured, false);
  await assert.rejects(cap.capitalCandles('US100', '5m'), /no está configurado/);
  assert.equal(calls.length, 0);
});

await test('credenciales malas: mensaje en español y nada guardado en sesión', async () => {
  cap.setCapitalConfig({ apiKey: 'KEY', identifier: 'a@b.c', password: 'bad' });
  const st = await cap.capitalStatus();
  assert.equal(st.ok, false);
  assert.match(st.error, /incorrectos/);
  cap.setCapitalConfig({ apiKey: 'NOPE', identifier: 'a@b.c', password: 'pw' });
  assert.match((await cap.capitalStatus()).error, /API key no es válida/);
});

await test('login con API key, identificador y contraseña sin cifrar; una sola sesión para muchas peticiones', async () => {
  cap.setCapitalConfig({ apiKey: 'KEY', identifier: 'a@b.c', password: 'pw', env: 'demo' });
  const before = logins;
  const st = await cap.capitalStatus();
  assert.deepEqual([st.ok, st.account], [true, 'ACC1']);
  await Promise.all([cap.capitalSearch('nasdaq'), cap.capitalQuotes(['US100']), cap.capitalCandles('US100', '15m')]);
  assert.equal(logins - before, 1);
  assert.ok(calls.some((c) => c.includes('demo-api-capital.backend-capital.com')), 'demo usa el host demo');
});

await test('búsqueda: forma de las filas y sin contaminar la precisión del gráfico', async () => {
  const rows = await cap.capitalSearch('nasdaq');
  assert.deepEqual(rows[0], { epic: 'US100', name: 'US Tech 100', type: 'Index CFD', category: 'cfd', bid: 21000, offer: 21001, change: 0.5, status: undefined });
  const c = await cap.capitalCandles('US100', '15m');
  assert.equal(c.meta.precision, 1); // de decimalPlacesFactor, no del bid redondo de la búsqueda
  assert.equal(c.meta.currency, 'USD');
});

await test('cotizaciones: precio bid, % del día y cierre anterior', async () => {
  const [q] = await cap.capitalQuotes(['US100', 'bad epic!']);
  assert.equal(q.symbol, 'US100');
  assert.equal(q.price, 21105);
  assert.equal(q.change, 0.5);
  assert.ok(Math.abs(q.prevClose - 21000) < 1e-9);
});

await test('velas nativas (15m) en UTC, ordenadas y con bid', async () => {
  const c = await cap.capitalCandles('US100', '15m');
  assert.ok(c.bars.length > 5);
  for (let i = 1; i < c.bars.length; i++) assert.ok(c.bars[i].time > c.bars[i - 1].time);
  assert.equal(c.bars.at(-1).time % 900, 0);
  assert.equal(c.bars[0].open, 21000);
  assert.equal(c.full, true);
});

await test('temporalidad agrupada (45m de 15m) en rejilla UTC', async () => {
  const c = await cap.capitalCandles('US100', '45m');
  assert.ok(c.bars.length >= 2);
  for (const b of c.bars) assert.equal(b.time % 2700, 0);
});

await test('diario: vela de las 22:00 UTC = día siguiente; dayStart para los ticks', async () => {
  const c = await cap.capitalCandles('US100', '1D');
  assert.equal(c.meta.dayStart, 79200);
  assert.equal(day(c.bars.at(-1).time), '2026-11-23'); // la vela que empezó el 22 a las 22:00 UTC
  for (const b of c.bars) assert.equal(b.time % 86400, 0);
});

await test('historial anterior: solo barras antes de la primera, y fecha absurda rechazada', async () => {
  const first = utc('2026-11-20T10:00:00');
  const c = await cap.capitalCandles('US100', '1m', first);
  assert.ok(c.bars.length > 0);
  assert.ok(c.bars.every((b) => b.time < first));
  await assert.rejects(cap.capitalCandles('US100', '1m', 1e15), /Fecha no válida/);
  await assert.rejects(cap.capitalCandles('US100', '1m', -5), /Fecha no válida/);
});

await test('instrumento o temporalidad no válidos', async () => {
  await assert.rejects(cap.capitalCandles('../session', '5m'), /no válido/);
  await assert.rejects(cap.capitalCandles('US100', 'xx'), /no válida/);
});

await test('sesión caducada (401): vuelve a iniciar sesión una vez y sigue', async () => {
  const before = logins;
  const saved = globalThis.fetch;
  let first = true;
  globalThis.fetch = async (url, opt = {}) => {
    if (first && String(url).includes('/prices/')) { first = false; return json({ errorCode: 'error.invalid.session.token' }, 401); }
    return saved(url, opt);
  };
  try {
    const c = await cap.capitalCandles('US100', '5m', null, 3);
    assert.ok(c.bars.length);
    assert.equal(logins - before, 1);
  } finally { globalThis.fetch = saved; }
});

await test('streaming: un WebSocket, suscripción con tokens, solo ticks de lo pedido, sin duplicados', async () => {
  sockets.length = 0;
  const s = new cap.CapitalStreamer();
  const got = [];
  const client = { symbols: new Set(['US100']), send: (t) => got.push(t) };
  s.attach(client);
  s.attach({ symbols: new Set(['US500']), send: () => {} });
  s.sync(); s.sync(); // cambios rápidos mientras inicia sesión: no debe abrir dos conexiones
  await new Promise((r) => setTimeout(r, 400));
  const open = sockets.filter((w) => !w.closed);
  assert.equal(open.length, 1);
  const sub = open[0].sent.find((m) => m.destination === 'marketData.subscribe');
  assert.deepEqual(sub.payload.epics, ['US100', 'US500']);
  assert.ok(sub.cst && sub.securityToken);
  assert.equal(open[0].url, 'wss://api-streaming-capital.backend-capital.com/connect');
  assert.deepEqual(got.map((t) => [t.s, t.p]), [['US100', 21002.3]]);
  s.detach(client);
  s.clients.clear();
  s.sync();
  assert.ok(open[0].closed, 'sin clientes se cierra');
});

await test('máximo 40 instrumentos por WebSocket', async () => {
  sockets.length = 0;
  const s = new cap.CapitalStreamer();
  s.attach({ symbols: new Set(Array.from({ length: 50 }, (_, i) => `E${String(i).padStart(2, '0')}`)), send: () => {} });
  await new Promise((r) => setTimeout(r, 400));
  const sub = sockets.at(-1).sent.find((m) => m.destination === 'marketData.subscribe');
  assert.equal(sub.payload.epics.length, 40);
  s.clients.clear(); s.sync();
});

// ---------------------------------------------------------------------------
// OANDA: fechas de negociación
// ---------------------------------------------------------------------------
const oanda = await import('../lib/oanda.mjs');
console.log('OANDA');
await test('el día de CFD/forex cierra a las 17:00 de Nueva York (invierno y verano)', () => {
  assert.equal(day(oanda.tradingDay(utc('2026-11-24T22:00:00'))), '2026-11-25');
  assert.equal(day(oanda.tradingDay(utc('2026-11-24T21:59:00'))), '2026-11-24');
  assert.equal(day(oanda.tradingDay(utc('2026-07-14T21:00:00'))), '2026-07-15');
  assert.equal(day(oanda.dailyBucket(utc('2026-11-22T22:00:00'), 'W')), '2026-11-23');
});
await test('OANDA sin token: error claro', async () => {
  oanda.setOandaConfig({});
  await assert.rejects(oanda.oandaCandles('NAS100_USD', '5m'), /no está configurado/);
  await assert.rejects(oanda.oandaCandles('NAS100_USD', '5m', 1e15), /Fecha no válida/);
});

// ---------------------------------------------------------------------------
// Servidor: los endpoints de brókers solo responden a la propia app
// ---------------------------------------------------------------------------
console.log('Servidor');
const { startServer, sameOriginRequest } = await import('../server.mjs');
const { server, port } = await startServer({ port: 0, host: '127.0.0.1' });
const get = (path, headers = {}) => new Promise((resolve, reject) => {
  const req = http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, cors: res.headers['access-control-allow-origin'], body }));
  });
  req.on('error', reject);
});

await test('la propia app (mismo origen) puede usar /api/capital', async () => {
  const r = await get('/api/capital/status', { 'Sec-Fetch-Site': 'same-origin' });
  assert.equal(r.status, 200);
  assert.equal(r.cors, undefined, 'sin CORS: otras webs no pueden leer la respuesta');
});
await test('otra web del navegador (cross-site) es rechazada', async () => {
  assert.equal((await get('/api/capital/status', { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://evil.example' })).status, 403);
  assert.equal((await get('/api/capital/stream?symbols=US100', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await get('/api/oanda/status', { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await get('/api/capital/status', { Origin: 'null' })).status, 403);
});
await test('DNS rebinding (Host ajeno) es rechazado', async () => {
  assert.equal((await get('/api/capital/status', { Host: 'evil.example:41573' })).status, 403);
});
await test('parámetros malos: 400, no 500', async () => {
  cap.setCapitalConfig({ apiKey: 'KEY', identifier: 'a@b.c', password: 'pw' });
  assert.equal((await get('/api/capital/candles?instrument=US100&tf=5m&before=1e20')).status, 400);
  assert.equal((await get('/api/capital/candles?instrument=%2E%2E%2Fx&tf=5m')).status, 400);
});
await test('sameOriginRequest', () => {
  assert.equal(sameOriginRequest({ headers: { host: '127.0.0.1:1' } }), true);
  assert.equal(sameOriginRequest({ headers: { host: '127.0.0.1:1', origin: 'http://127.0.0.1:1' } }), true);
  assert.equal(sameOriginRequest({ headers: { host: '127.0.0.1:1', origin: 'http://127.0.0.1:2' } }), false);
  assert.equal(sameOriginRequest({ headers: { host: '127.0.0.1:1', 'sec-fetch-site': 'same-site' } }), false);
});
server.close();

console.log(failed ? `\n${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
