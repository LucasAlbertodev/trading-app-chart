// Estadísticas de un conjunto de operaciones, al estilo de FX Replay y FTMO: P&L, win rate,
// profit factor, R:R, expectativa, drawdown, rachas, Sharpe, y desgloses por día de la semana,
// hora, mes, símbolo y lado. Funciones puras (test/journal.test.mjs).

const DAY = 86400;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
function std(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

/**
 * trades: operaciones del journal ordenadas por cierre. startBalance: balance inicial.
 * opts.breakeven: |pnl| <= umbral cuenta como breakeven. opts.tzOffset: segundos a sumar a UTC
 * para agrupar por día/hora en la zona horaria elegida.
 */
export function computeStats(trades, startBalance = 100000, { breakeven = 0, tzOffset = 0 } = {}) {
  const be = Math.max(0, Number(breakeven) || 0);
  const n = trades.length;
  const wins = trades.filter((t) => t.pnl > be);
  const losses = trades.filter((t) => t.pnl < -be);
  const bes = trades.filter((t) => Math.abs(t.pnl) <= be);
  const sum = (a) => a.reduce((s, t) => s + t.pnl, 0);
  const grossProfit = sum(wins);
  const grossLoss = sum(losses); // negativo
  const net = sum(trades);
  const avgWin = wins.length ? grossProfit / wins.length : null;
  const avgLoss = losses.length ? grossLoss / losses.length : null;

  // Curva de equity y drawdown
  let equity = startBalance, peak = startBalance, maxDD = 0, maxDDPct = 0;
  const curve = [{ time: trades[0]?.entryTime ?? trades[0]?.exitTime ?? null, equity: startBalance, drawdown: 0 }];
  for (const t of trades) {
    equity += t.pnl;
    peak = Math.max(peak, equity);
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
    if (peak > 0 && dd / peak > maxDDPct) maxDDPct = dd / peak;
    curve.push({ time: t.exitTime, equity, drawdown: dd });
  }

  // Rachas
  let cw = 0, cl = 0, maxCW = 0, maxCL = 0;
  for (const t of trades) {
    if (t.pnl > be) { cw++; cl = 0; } else if (t.pnl < -be) { cl++; cw = 0; } else { cw = 0; cl = 0; }
    maxCW = Math.max(maxCW, cw);
    maxCL = Math.max(maxCL, cl);
  }

  // Rendimiento por operación (% del balance al abrir) → Sharpe por operación
  let bal = startBalance;
  const rets = [];
  for (const t of trades) { if (bal > 0) rets.push(t.pnl / bal); bal += t.pnl; }
  const sd = std(rets);
  const rs = trades.map((t) => t.r).filter((x) => x != null);
  const durations = trades.filter((t) => t.entryTime != null && t.exitTime != null).map((t) => t.exitTime - t.entryTime);

  // Desgloses (en la zona horaria elegida)
  const local = (t) => (t ?? 0) + tzOffset;
  const bucket = () => ({ pnl: 0, trades: 0, wins: 0 });
  const add = (b, t) => { b.pnl += t.pnl; b.trades++; if (t.pnl > be) b.wins++; };
  const byWeekday = Array.from({ length: 7 }, bucket); // 0 = lunes … 6 = domingo
  const byHour = Array.from({ length: 24 }, bucket);
  const byMonth = new Map(), byWeek = new Map(), byDay = new Map(), bySymbol = new Map();
  const bySide = { long: bucket(), short: bucket() };
  for (const t of trades) {
    const lt = local(t.exitTime);
    const d = new Date(lt * 1000);
    add(byWeekday[(d.getUTCDay() + 6) % 7], t);
    add(byHour[d.getUTCHours()], t);
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const dayN = Math.floor(lt / DAY);
    const monday = dayN - ((((dayN + 3) % 7) + 7) % 7);
    for (const [map, key] of [[byMonth, month], [byWeek, monday * DAY], [byDay, dayN * DAY], [bySymbol, t.symbol]]) {
      if (!map.has(key)) map.set(key, bucket());
      add(map.get(key), t);
    }
    add(bySide[t.side === 'short' ? 'short' : 'long'], t);
  }
  const avgOf = (map) => (map.size ? [...map.values()].reduce((s, b) => s + b.pnl, 0) / map.size : null);
  const days = [...byDay.entries()].sort((a, b) => a[0] - b[0]);

  return {
    trades: n,
    wins: wins.length, losses: losses.length, breakeven: bes.length,
    winRate: n ? (wins.length / n) * 100 : null,
    net, netPct: startBalance ? (net / startBalance) * 100 : null,
    startBalance, balance: startBalance + net,
    grossProfit, grossLoss,
    profitFactor: losses.length ? grossProfit / -grossLoss : wins.length ? Infinity : null,
    avgWin, avgLoss,
    avgRR: avgWin != null && avgLoss ? avgWin / -avgLoss : null, // R:R medio (ganancia media / pérdida media)
    expectancy: n ? net / n : null, // $ por operación
    avgR: rs.length ? mean(rs) : null, // R medio de las operaciones con stop
    totalR: rs.length ? rs.reduce((s, x) => s + x, 0) : null,
    largestWin: wins.length ? Math.max(...wins.map((t) => t.pnl)) : null,
    largestLoss: losses.length ? Math.min(...losses.map((t) => t.pnl)) : null,
    maxConsecWins: maxCW, maxConsecLosses: maxCL,
    maxDrawdown: maxDD, maxDrawdownPct: maxDDPct * 100,
    recoveryFactor: maxDD > 0 ? net / maxDD : null,
    sharpe: sd ? mean(rets) / sd : null, // por operación (sin anualizar)
    avgDuration: durations.length ? mean(durations) : null,
    longs: bySide.long, shorts: bySide.short,
    avgDaily: avgOf(byDay), avgWeekly: avgOf(byWeek), avgMonthly: avgOf(byMonth),
    bestDay: days.length ? days.reduce((a, b) => (b[1].pnl > a[1].pnl ? b : a)) : null,
    worstDay: days.length ? days.reduce((a, b) => (b[1].pnl < a[1].pnl ? b : a)) : null,
    tradingDays: byDay.size,
    byWeekday, byHour,
    byMonth: [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    bySymbol: [...bySymbol.entries()].sort((a, b) => b[1].trades - a[1].trades),
    byDay: days,
    curve,
  };
}
