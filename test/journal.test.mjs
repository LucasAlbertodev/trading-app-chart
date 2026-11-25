// Tests del journal de backtesting (public/js/journal.js), sus estadísticas (journal-stats.js),
// la visibilidad de dibujos por temporalidad (drawings.js) y las zonas horarias (tz.js).
// Run: node test/journal.test.mjs
import assert from 'node:assert/strict';
import { Journal, migrate, emptyJournal, riskOf } from '../public/js/journal.js';
import { computeStats } from '../public/js/journal-stats.js';
import { tzOffsetAt, tzList, offsetLabel, cityName } from '../public/js/tz.js';
import { isVisibleIn, visGroupOf, DrawingLayer } from '../public/js/drawings.js';
import { PaperAccount } from '../public/js/paper.js';

let failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.stack.split('\n').slice(0, 3).join('\n       ')}`); }
};
const utc = (s) => Date.parse(`${s}Z`) / 1000;
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const trade = (pnl, exit, extra = {}) => ({ symbol: 'CAPITAL:US100', side: 'long', qty: 1, entry: 100, exit: 100 + pnl, pnl, entryTime: utc(exit) - 3600, exitTime: utc(exit), ...extra });

console.log('Journal');
test('journal vacío: un usuario y una estrategia activos', () => {
  const j = new Journal();
  assert.equal(j.users.length, 1);
  assert.equal(j.activeStrategy.userId, j.activeUser.id);
  assert.equal(j.data.version, 1);
});

test('migrate repara datos rotos y cierra sesiones "en curso"', () => {
  assert.deepEqual(Object.keys(migrate(null)), Object.keys(emptyJournal()));
  const j = migrate({ users: [{ id: 'u1', name: 'Ana' }], strategies: [], sessions: [{ id: 's1', userId: 'u1', strategyId: 'x', status: 'running' }], trades: [{ id: 't1', pnl: 'nope' }, { id: 't2', pnl: 5, side: 'short' }] });
  assert.equal(j.activeUserId, 'u1');
  assert.equal(j.strategies.length, 1, 'crea una estrategia General');
  assert.equal(j.sessions[0].status, 'done');
  assert.deepEqual(j.trades.map((t) => t.id), ['t2']);
});

test('sesión de replay: operaciones, balance, continuar y borrar', () => {
  let saves = 0;
  const j = new Journal(null, { onChange: () => saves++ });
  const sid = j.startSession({ symbol: 'CAPITAL:US100', tf: '5m', startBalance: 10000, replayFrom: utc('2026-08-03T13:00') }).id;
  j.addTrade(sid, trade(200, '2026-08-03T14:00', { sl: 90 }));
  j.addTrade(sid, trade(-100, '2026-08-04T15:00'));
  assert.equal(j.balanceOf(sid), 10100);
  j.endSession(sid, {});
  const s = j.session(sid);
  assert.deepEqual([s.status, s.endBalance, s.replayTo], ['done', 10100, utc('2026-08-04T15:00')]);
  assert.equal(j.query({ sessionId: sid })[0].r, 20, 'R = 200 / (|100-90| × 1)');
  // Continuar: el próximo replay sigue la misma sesión con su balance.
  j.setContinueSession(sid);
  assert.equal(j.continueSession.id, sid);
  assert.equal(j.startSession({ symbol: 'CAPITAL:US100', tf: '5m', startBalance: 10100 }).id, sid);
  assert.equal(j.data.continueSessionId, null);
  assert.ok(saves > 3);
  j.deleteSession(sid);
  assert.equal(j.data.trades.length, 0);
});

test('usuarios y estrategias separan los datos', () => {
  const j = new Journal();
  const a = j.startSession({ symbol: 'CAPITAL:US100', tf: '1h', startBalance: 100000 }).id;
  j.addTrade(a, trade(50, '2026-08-05T10:00'));
  const s2 = j.addStrategy('ICT', 'Reglas');
  const b = j.startSession({ symbol: 'CAPITAL:US500', tf: '15m', startBalance: 100000 }).id;
  j.addTrade(b, trade(-20, '2026-08-05T11:00', { symbol: 'CAPITAL:US500' }));
  assert.equal(j.query({ strategyId: s2.id }).length, 1);
  assert.equal(j.query({}).length, 2, 'todas las estrategias del usuario');
  const u2 = j.addUser('Pedro');
  assert.equal(j.data.activeUserId, u2.id);
  assert.equal(j.query({}).length, 0, 'otro usuario no ve las operaciones');
  assert.equal(j.deleteUser(u2.id), true);
  assert.equal(j.query({}).length, 2);
  assert.equal(j.deleteUser(j.data.activeUserId), false, 'no se borra el último usuario');
});

test('filtros: lado, resultado con umbral breakeven, fechas, etiquetas', () => {
  const j = new Journal();
  const sid = j.startSession({ symbol: 'CAPITAL:US100', tf: '5m', startBalance: 1000 }).id;
  const t1 = j.addTrade(sid, trade(10, '2026-08-03T10:00'));
  j.addTrade(sid, trade(-0.5, '2026-08-04T10:00', { side: 'short' }));
  j.addTrade(sid, trade(-30, '2026-08-05T10:00'));
  j.updateTrade(t1.id, { tags: 'ny open, a+', notes: 'buena', setup: 'FVG' });
  assert.equal(j.query({ side: 'short' }).length, 1);
  assert.equal(j.query({ outcome: 'be', breakeven: 1 }).length, 1);
  assert.equal(j.query({ outcome: 'loss', breakeven: 1 }).length, 1);
  assert.equal(j.query({ from: utc('2026-08-04T00:00'), to: utc('2026-08-04T23:59') }).length, 1);
  assert.deepEqual(j.query({ tag: 'a+' }).map((t) => t.notes), ['buena']);
});

test('exportar e importar sin duplicar; CSV con cabecera', () => {
  const j = new Journal();
  const sid = j.startSession({ symbol: 'CAPITAL:US100', tf: '5m', startBalance: 1000 }).id;
  j.addTrade(sid, trade(10, '2026-08-03T10:00', { notes: 'con, coma' }));
  const text = j.exportJSON();
  const k = new Journal();
  const r = k.importJSON(text);
  assert.deepEqual([r.sessions, r.trades], [1, 1]);
  assert.deepEqual(k.importJSON(text), { users: 0, strategies: 0, sessions: 0, trades: 0 });
  const csv = j.tradesCSV(j.query({}));
  assert.ok(csv.startsWith('strategy,session,symbol,side'));
  assert.ok(csv.includes('"con, coma"'));
  assert.throws(() => k.importJSON('{no json'));
});

test('riesgo y R solo con stop', () => {
  assert.deepEqual(riskOf({ entry: 100, sl: null, qty: 1, pnl: 5 }), { risk: null, r: null });
  assert.deepEqual(riskOf({ entry: 100, sl: 95, qty: 2, pnl: 20 }), { risk: 10, r: 2 });
});

console.log('Estadísticas');
test('métricas básicas como FX Replay / FTMO', () => {
  const tr = [trade(300, '2026-08-03T14:00'), trade(-100, '2026-08-04T14:00'), trade(-100, '2026-08-05T14:00'), trade(200, '2026-08-06T09:00', { side: 'short' }), trade(0, '2026-08-07T09:00')];
  const s = computeStats(tr, 10000);
  assert.equal(s.trades, 5);
  assert.deepEqual([s.wins, s.losses, s.breakeven], [2, 2, 1]);
  assert.equal(s.winRate, 40);
  assert.equal(s.net, 300);
  near(s.netPct, 3);
  assert.equal(s.balance, 10300);
  assert.equal(s.profitFactor, 2.5);
  assert.equal(s.avgWin, 250);
  assert.equal(s.avgLoss, -100);
  assert.equal(s.avgRR, 2.5);
  assert.equal(s.expectancy, 60);
  assert.equal(s.maxDrawdown, 200);
  near(s.maxDrawdownPct, (200 / 10300) * 100);
  assert.deepEqual([s.maxConsecWins, s.maxConsecLosses], [1, 2]);
  assert.equal(s.largestWin, 300);
  assert.equal(s.largestLoss, -100);
  assert.equal(s.curve.length, 6);
  assert.equal(s.curve.at(-1).equity, 10300);
  assert.equal(s.avgDuration, 3600);
  assert.equal(s.shorts.trades, 1);
  assert.equal(s.tradingDays, 5);
});

test('desgloses por día, hora y mes en la zona horaria elegida', () => {
  // Lunes 3 ago 2026, 23:30 UTC = martes 01:30 en UTC+2.
  const tr = [trade(50, '2026-08-03T23:30'), trade(-20, '2026-09-02T10:00')];
  const u = computeStats(tr, 1000);
  assert.equal(u.byWeekday[0].pnl, 50, 'lunes en UTC');
  assert.equal(u.byHour[23].trades, 1);
  const p2 = computeStats(tr, 1000, { tzOffset: 7200 });
  assert.equal(p2.byWeekday[1].pnl, 50, 'martes en UTC+2');
  assert.equal(p2.byHour[1].trades, 1);
  assert.deepEqual(p2.byMonth.map(([k]) => k), ['2026-08', '2026-09']);
  assert.equal(u.avgMonthly, 15);
});

test('sin operaciones: nada roto', () => {
  const s = computeStats([], 5000);
  assert.deepEqual([s.trades, s.winRate, s.net, s.balance, s.profitFactor], [0, null, 0, 5000, null]);
  assert.equal(s.curve.length, 1);
});

test('paper.js guarda el stop inicial en la operación (para el R)', () => {
  const a = new PaperAccount({ balance: 10000 });
  a.placeOrder({ symbol: 'X', side: 'buy', type: 'market', qty: 2, sl: 95, tp: 110 }, { price: 100, time: 1 });
  a.setBracket('X', { sl: 99 }); // mover el stop no cambia el riesgo inicial
  a.closePosition('X', { price: 106, time: 2 });
  const t = a.trades[0];
  assert.deepEqual([t.sl, t.tp, t.pnl], [95, 110, 12]);
  assert.deepEqual(riskOf(t), { risk: 10, r: 1.2 });
});

console.log('Zonas horarias y dibujos');
test('desfases UTC con horario de verano', () => {
  assert.equal(tzOffsetAt('UTC'), 0);
  assert.equal(tzOffsetAt('America/New_York', utc('2026-01-15T12:00')), -5 * 3600);
  assert.equal(tzOffsetAt('America/New_York', utc('2026-07-15T12:00')), -4 * 3600);
  assert.equal(tzOffsetAt('America/Argentina/Buenos_Aires', utc('2026-07-15T12:00')), -3 * 3600);
  assert.equal(tzOffsetAt('Asia/Kolkata', utc('2026-07-15T12:00')), 5.5 * 3600);
  assert.equal(offsetLabel(-5 * 3600), 'UTC−05:00');
  assert.equal(offsetLabel(5.5 * 3600), 'UTC+05:30');
  assert.equal(cityName('America/Argentina/Buenos_Aires'), 'Buenos Aires (America)');
});

test('lista completa de zonas, ordenada de UTC−12 a UTC+14', () => {
  const list = tzList(utc('2026-07-15T12:00'));
  assert.ok(list.length > 300, `${list.length} zonas`);
  assert.equal(list[0].tz, 'UTC');
  const rest = list.slice(1);
  for (let i = 1; i < rest.length; i++) assert.ok(rest[i].offset >= rest[i - 1].offset);
  assert.ok(rest[0].offset <= -11 * 3600 && rest.at(-1).offset >= 13 * 3600);
  assert.ok(list.some((z) => z.tz.endsWith('Buenos_Aires') && z.label.includes('Buenos Aires')));
});

test('visibilidad de dibujos por tipo de temporalidad', () => {
  assert.equal(isVisibleIn({}, 'm'), true, 'sin vis: en todas');
  const d = { vis: { m: false, h: true, D: true, W: false, M: false } };
  assert.deepEqual(['m', 'h', 'D', 'W', 'M'].map((g) => isVisibleIn(d, g)), [false, true, true, false, false]);
  assert.equal(visGroupOf('x'), 'm');
});


// Drawings across timeframes: a fake chart whose time scale, like Lightweight Charts 5, only
// converts whole bar indexes (a fraction comes back as 0).
function layerOn(bars, tfSec, tz, saved) {
  globalThis.localStorage = { _s: { 'wickline.drawings.X': JSON.stringify(saved) }, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = String(v); } };
  const L = new DrawingLayer({ formatPrice: String });
  L.chart = { timeScale: () => ({ logicalToCoordinate: (l) => (Number.isInteger(l) ? 100 + l * 10 : 0), width: () => 1000 }) };
  L.series = { priceToCoordinate: (p) => p };
  L.setContext('X', tfSec, null, tz);
  L.setBars(bars);
  return L;
}
const mins = (start, step, n) => Array.from({ length: n }, (_, i) => ({ time: start + i * step }));

test('a point drawn on 1m lands between 5m bars (not at the left edge)', () => {
  const T0 = utc('2026-11-25T14:00');
  const L = layerOn(mins(T0, 300, 12), 300, 0, [{ id: 'a', type: 'trend', u: 1, p1: { time: T0 + 120, price: 1 }, p2: { time: T0 + 900, price: 2 } }]);
  assert.equal(L.logicalFromTime(T0 + 120), 0.4);
  assert.equal(L._x(T0 + 120), 104, 'between bar 0 (x=100) and bar 1 (x=110)');
  assert.equal(L._x(T0 + 900), 130);
});

test('drawings are saved in UTC: same place on intraday and daily charts and in any time zone', () => {
  const T0 = utc('2026-11-25T14:00');
  // Old drawing saved in chart time of an UTC−3 chart: converted once to UTC.
  const L = layerOn(mins(T0 - 3 * 3600, 60, 60), 60, -3 * 3600, [{ id: 'a', type: 'hline', p1: { time: T0 - 3 * 3600 + 600, price: 5 }, p2: { time: T0 - 3 * 3600 + 600, price: 5 } }]);
  assert.equal(L.items[0].u, 1);
  assert.equal(L.items[0].p1.time, T0 + 600, 'stored in UTC');
  assert.equal(L.logicalFromTime(L.items[0].p1.time), 10);
  assert.equal(JSON.parse(localStorage.getItem('wickline.drawings.X'))[0].p1.time, T0 + 600, 'saved once');
  // The same drawing on a chart shown in UTC+2: still at the same bar, not converted again.
  const M = layerOn(mins(T0 + 2 * 3600, 60, 60), 60, 2 * 3600, JSON.parse(localStorage.getItem('wickline.drawings.X')));
  assert.equal(M.items[0].p1.time, T0 + 600);
  assert.equal(M.logicalFromTime(M.items[0].p1.time), 10);
  // timeFromLogical is the inverse (UTC out).
  assert.equal(M.timeFromLogical(10), T0 + 600);
  assert.equal(M.timeFromLogical(2.5), T0 + 150);
});

test('before the loaded history: extrapolates with the average bar spacing (nights, weekends)', () => {
  const T0 = utc('2026-11-23T00:00');
  // 1m bars with a 2-day gap in the middle: average spacing ≫ 60 s.
  const bars = [...mins(T0, 60, 100), ...mins(T0 + 2 * 86400, 60, 100)];
  const L = layerOn(bars, 60, 0, []);
  const avg = (bars.at(-1).time - bars[0].time) / (bars.length - 1);
  const t = T0 - 86400;
  near(L.logicalFromTime(t), -86400 / avg);
  assert.ok(L.logicalFromTime(t) > -1440, 'not a day of 1-minute bars to the left');
  assert.equal(L.timeFromLogical(L.logicalFromTime(t)), t);
});

console.log(failed ? `\n${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
