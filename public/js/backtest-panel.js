// Panel de Backtesting: usuarios, estrategias, sesiones y analítica (estilo FX Replay / FTMO).
//
// Cada replay es una sesión del usuario y la estrategia activos; cada operación cerrada en él se
// guarda en el journal (journal.js) y alimenta las estadísticas (journal-stats.js).
// Persistencia: archivo en la app de escritorio (userData/journal/journal.json, con copia de
// seguridad), o localStorage en el navegador.

import { Journal } from './journal.js';
import { computeStats } from './journal-stats.js';
import { lang, locale } from './i18n.js';
import { esc } from './util.js';
import { getTz, tzOffsetAt } from './tz.js';

// --- textos (español / inglés) ----------------------------------------------
const TXT = {
  es: {
    title: 'Backtesting', user: 'Usuario', strategy: 'Estrategia', newUser: 'Nuevo usuario', newStrategy: 'Nueva estrategia',
    rename: 'Renombrar', del: 'Borrar', edit: 'Editar', close: 'Cerrar', dashboard: 'Resumen', sessions: 'Sesiones', trades: 'Operaciones', strategies: 'Estrategias',
    allSessions: 'Todas las sesiones', allSymbols: 'Todos los activos', allStrategies: 'Todas las estrategias', side: 'Lado', both: 'Ambos', long: 'Largo', short: 'Corto',
    outcome: 'Resultado', all: 'Todos', win: 'Ganadoras', loss: 'Perdedoras', be: 'Breakeven', from: 'Desde', to: 'Hasta', beThreshold: 'Umbral breakeven ($)',
    clear: 'Limpiar filtros', exportCsv: 'Exportar CSV', exportJson: 'Copia (JSON)', importJson: 'Importar JSON',
    totalPnl: 'P&L total', balance: 'Balance', winRate: 'Win rate', tradesN: 'Operaciones', pf: 'Profit factor', rr: 'R:R medio', expectancy: 'Expectativa / op.',
    avgR: 'R medio', maxDD: 'Drawdown máx.', largestWin: 'Mayor ganancia', largestLoss: 'Mayor pérdida', streaks: 'Rachas (G / P)', sharpe: 'Sharpe (por op.)',
    duration: 'Duración media', dayAvg: 'Media diaria', weekAvg: 'Media semanal', monthAvg: 'Media mensual', bestDay: 'Mejor día', worstDay: 'Peor día',
    longs: 'Largos', shorts: 'Cortos', recovery: 'Factor de recuperación', avgWin: 'Ganancia media', avgLoss: 'Pérdida media', tradingDays: 'Días operados',
    equity: 'Curva de equity', byWeekday: 'P&L por día de la semana', byHour: 'P&L por hora', byMonth: 'P&L mensual', bySymbol: 'Por activo',
    days: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
    empty: 'Todavía no hay operaciones. Abre un replay (botón Replay), opera con el panel Trade y cada operación cerrada se guardará aquí, en la estrategia activa.',
    nextReplay: 'Próximo replay', newSession: 'Sesión nueva', continueS: 'Continuar', continuing: 'Continuará', sessionName: 'Sesión', symbol: 'Activo', tf: 'TF',
    period: 'Periodo replay', updated: 'Actualizada', actions: '', view: 'Ver', date: 'Cierre', qty: 'Cant.', entry: 'Entrada', exit: 'Salida', pnl: 'P&L', r: 'R',
    reason: 'Motivo', tags: 'Etiquetas', notes: 'Notas', setup: 'Setup', noSessions: 'Sin sesiones todavía.', confirmDelSession: '¿Borrar la sesión «{name}» y sus {n} operaciones? No se puede deshacer.',
    confirmDelUser: '¿Borrar el usuario «{name}» con TODAS sus estrategias, sesiones y operaciones? No se puede deshacer.', confirmDelTrade: '¿Borrar esta operación?',
    namePrompt: 'Nombre:', descPrompt: 'Descripción / reglas de la estrategia:', imported: 'Importado: {s} sesiones, {t} operaciones.', importFail: 'No se pudo importar: {e}',
    saved: 'Guardado en este ordenador', running: 'en curso', description: 'Descripción', archive: 'Archivar', unarchive: 'Restaurar', archived: 'archivada',
    sessionsShort: 'sesiones', hint: 'Elige usuario y estrategia antes de empezar un replay: sus operaciones se guardan ahí.', drawdown: 'Drawdown',
    tradesCount: '{n} op.', winsLosses: '{w} G / {l} P', notesPrompt: 'Notas de la operación:', tagsPrompt: 'Etiquetas (separadas por comas):', setupPrompt: 'Setup:',
  },
  en: {
    title: 'Backtesting', user: 'User', strategy: 'Strategy', newUser: 'New user', newStrategy: 'New strategy',
    rename: 'Rename', del: 'Delete', edit: 'Edit', close: 'Close', dashboard: 'Dashboard', sessions: 'Sessions', trades: 'Trades', strategies: 'Strategies',
    allSessions: 'All sessions', allSymbols: 'All assets', allStrategies: 'All strategies', side: 'Side', both: 'Both', long: 'Long', short: 'Short',
    outcome: 'Outcome', all: 'All', win: 'Wins', loss: 'Losses', be: 'Breakeven', from: 'From', to: 'To', beThreshold: 'Breakeven threshold ($)',
    clear: 'Clear filters', exportCsv: 'Export CSV', exportJson: 'Backup (JSON)', importJson: 'Import JSON',
    totalPnl: 'Total P&L', balance: 'Balance', winRate: 'Win rate', tradesN: 'Trades', pf: 'Profit factor', rr: 'Avg R:R', expectancy: 'Expectancy / trade',
    avgR: 'Avg R', maxDD: 'Max drawdown', largestWin: 'Largest win', largestLoss: 'Largest loss', streaks: 'Streaks (W / L)', sharpe: 'Sharpe (per trade)',
    duration: 'Avg duration', dayAvg: 'Daily avg', weekAvg: 'Weekly avg', monthAvg: 'Monthly avg', bestDay: 'Best day', worstDay: 'Worst day',
    longs: 'Longs', shorts: 'Shorts', recovery: 'Recovery factor', avgWin: 'Avg win', avgLoss: 'Avg loss', tradingDays: 'Days traded',
    equity: 'Equity curve', byWeekday: 'P&L by weekday', byHour: 'P&L by hour', byMonth: 'Monthly P&L', bySymbol: 'By asset',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    empty: 'No trades yet. Start a replay (Replay button), trade it with the Trade panel, and every closed trade is saved here under the active strategy.',
    nextReplay: 'Next replay', newSession: 'New session', continueS: 'Continue', continuing: 'Will continue', sessionName: 'Session', symbol: 'Asset', tf: 'TF',
    period: 'Replay period', updated: 'Updated', actions: '', view: 'View', date: 'Closed', qty: 'Qty', entry: 'Entry', exit: 'Exit', pnl: 'P&L', r: 'R',
    reason: 'Reason', tags: 'Tags', notes: 'Notes', setup: 'Setup', noSessions: 'No sessions yet.', confirmDelSession: 'Delete session “{name}” and its {n} trades? This cannot be undone.',
    confirmDelUser: 'Delete user “{name}” with ALL their strategies, sessions and trades? This cannot be undone.', confirmDelTrade: 'Delete this trade?',
    namePrompt: 'Name:', descPrompt: 'Strategy description / rules:', imported: 'Imported: {s} sessions, {t} trades.', importFail: 'Could not import: {e}',
    saved: 'Saved on this computer', running: 'running', description: 'Description', archive: 'Archive', unarchive: 'Restore', archived: 'archived',
    sessionsShort: 'sessions', hint: 'Pick the user and strategy before starting a replay: its trades are saved there.', drawdown: 'Drawdown',
    tradesCount: '{n} trades', winsLosses: '{w} W / {l} L', notesPrompt: 'Trade notes:', tagsPrompt: 'Tags (comma separated):', setupPrompt: 'Setup:',
  },
};
const L = (k, vars = {}) => {
  const s = (TXT[lang] || TXT[lang?.startsWith('es') ? 'es' : 'en'] || TXT.en)[k] ?? TXT.en[k] ?? k;
  return typeof s === 'string' ? s.replace(/\{(\w+)\}/g, (_, v) => (vars[v] ?? '')) : s;
};

// --- formato ------------------------------------------------------------------
const money = (v, sign = false) => (v == null || !Number.isFinite(v) ? '—'
  : `${sign && v > 0 ? '+' : v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pct = (v, d = 2, sign = false) => (v == null || !Number.isFinite(v) ? '—' : `${sign && v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`);
const num = (v, d = 2) => (v == null ? '—' : v === Infinity ? '∞' : Number.isFinite(v) ? v.toFixed(d) : '—');
const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
const dur = (s) => {
  if (s == null) return '—';
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} d`;
};
const tzOff = () => tzOffsetAt(getTz());
const dateText = (t, withTime = true) => (t == null ? '—' : new Date((t + tzOff()) * 1000).toLocaleString(locale, {
  timeZone: 'UTC', year: 'numeric', month: 'short', day: '2-digit', ...(withTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}),
}));
const dayInput = (s, end) => { if (!s) return null; const t = Date.parse(`${s}T00:00:00Z`) / 1000 - tzOff(); return end ? t + 86399 : t; };

// --- persistencia -----------------------------------------------------------
const LS_KEY = 'wickline.journal';
const adapter = {
  async load() {
    const api = window.wicklineDesktop;
    if (api?.loadJournal) {
      const text = await api.loadJournal().catch(() => null);
      if (text) { try { return JSON.parse(text); } catch { /* corrupto: usa localStorage */ } }
    }
    try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; }
  },
  save(data) {
    const text = JSON.stringify(data);
    const api = window.wicklineDesktop;
    if (api?.saveJournal) api.saveJournal(text).catch(() => {});
    else { try { localStorage.setItem(LS_KEY, text); } catch { /* lleno */ } }
  },
};

// --- gráficos (canvas, con hover) ---------------------------------------------
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const EQUITY_COLOR = '#4FA3F7';

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.font = '11px system-ui, -apple-system, sans-serif';
  return { ctx, w, h };
}

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const step0 = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Number(v.toFixed(10)));
  return out;
}
const shortMoney = (v) => {
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k` : a.toFixed(0);
  return `${v < 0 ? '−' : ''}${s}`;
};

function axisAndGrid(ctx, w, h, pad, ticks, y) {
  ctx.strokeStyle = css('--border') || '#2a2e39';
  ctx.fillStyle = css('--muted') || '#888';
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of ticks) {
    const yy = Math.round(y(v)) + 0.5;
    ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(w - pad.r, yy); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText(shortMoney(v), pad.l - 6, yy);
  }
}

/** Curva de equity: una serie (sin leyenda: el título la nombra), cruz y tooltip al pasar el ratón. */
function drawEquity(canvas, tip, curve) {
  const draw = (hoverX = null) => {
    const { ctx, w, h } = setupCanvas(canvas);
    if (curve.length < 2) return;
    const pad = { l: 56, r: 12, t: 10, b: 22 };
    const vals = curve.map((p) => p.equity);
    const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
    const lo = ticks[0], hi = ticks[ticks.length - 1];
    const x = (i) => pad.l + (i / (curve.length - 1)) * (w - pad.l - pad.r);
    const y = (v) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (h - pad.t - pad.b);
    axisAndGrid(ctx, w, h, pad, ticks, y);
    // Línea base: el balance inicial
    ctx.setLineDash([4, 4]); ctx.strokeStyle = css('--muted'); ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.moveTo(pad.l, y(curve[0].equity)); ctx.lineTo(w - pad.r, y(curve[0].equity)); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    // Área suave + línea de 2px
    ctx.beginPath();
    curve.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p.equity)) : ctx.moveTo(x(i), y(p.equity))));
    ctx.strokeStyle = EQUITY_COLOR; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.lineTo(x(curve.length - 1), h - pad.b); ctx.lineTo(x(0), h - pad.b); ctx.closePath();
    ctx.globalAlpha = 0.10; ctx.fillStyle = EQUITY_COLOR; ctx.fill(); ctx.globalAlpha = 1;
    // Etiquetas de fecha en los extremos
    ctx.fillStyle = css('--muted'); ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left'; ctx.fillText(dateText(curve[1].time, false), pad.l, h - 6);
    ctx.textAlign = 'right'; ctx.fillText(dateText(curve[curve.length - 1].time, false), w - pad.r, h - 6);
    if (hoverX == null) { tip.hidden = true; return; }
    const i = Math.max(0, Math.min(curve.length - 1, Math.round(((hoverX - pad.l) / (w - pad.l - pad.r)) * (curve.length - 1))));
    const p = curve[i];
    ctx.strokeStyle = css('--muted'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x(i) + 0.5, pad.t); ctx.lineTo(x(i) + 0.5, h - pad.b); ctx.stroke();
    ctx.beginPath(); ctx.arc(x(i), y(p.equity), 4, 0, Math.PI * 2);
    ctx.fillStyle = EQUITY_COLOR; ctx.fill(); ctx.strokeStyle = css('--panel') || '#111'; ctx.lineWidth = 2; ctx.stroke();
    tip.hidden = false;
    tip.innerHTML = `<b>${esc(money(p.equity))}</b><span>${i ? esc(dateText(p.time)) : esc(L('balance'))}</span>${p.drawdown > 0 ? `<span>${esc(L('drawdown'))}: ${esc(money(-p.drawdown))}</span>` : ''}`;
    tip.style.left = `${Math.min(x(i) + 10, w - tip.offsetWidth - 4)}px`;
    tip.style.top = `${Math.max(0, y(p.equity) - tip.offsetHeight - 8)}px`;
  };
  canvas.onmousemove = (e) => draw(e.offsetX);
  canvas.onmouseleave = () => draw(null);
  draw(null);
  return draw;
}

/**
 * Barras de P&L con signo: hacia arriba (ganancia) o hacia abajo (pérdida) desde la línea de cero,
 * con extremos redondeados de 4px, 2px de separación y tooltip por barra. El signo se lee por la
 * posición, no solo por el color (verde/rojo del tema).
 */
function drawBars(canvas, tip, items) {
  const draw = (hover = null) => {
    const { ctx, w, h } = setupCanvas(canvas);
    if (!items.length) return;
    const pad = { l: 56, r: 8, t: 10, b: 22 };
    const vals = items.map((b) => b.value);
    const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
    const lo = ticks[0], hi = ticks[ticks.length - 1];
    const y = (v) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (h - pad.t - pad.b);
    axisAndGrid(ctx, w, h, pad, ticks, y);
    const slot = (w - pad.l - pad.r) / items.length;
    const bw = Math.max(2, Math.min(36, slot - 2));
    const zero = y(0);
    let hit = null;
    items.forEach((b, i) => {
      const cx = pad.l + slot * i + slot / 2;
      const top = y(b.value);
      const x0 = cx - bw / 2;
      const hgt = Math.abs(top - zero);
      if (hgt >= 1) {
        ctx.fillStyle = b.value >= 0 ? css('--up') : css('--down');
        ctx.globalAlpha = hover == null || hover === i ? 1 : 0.55;
        const r = Math.min(4, bw / 2, hgt);
        ctx.beginPath();
        if (b.value >= 0) ctx.roundRect(x0, top, bw, hgt, [r, r, 0, 0]);
        else ctx.roundRect(x0, zero, bw, hgt, [0, 0, r, r]);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (hover === i) hit = { b, cx, top: Math.min(top, zero) };
      // Etiqueta del eje X (todas si caben; si no, una de cada pocas)
      const every = Math.ceil(items.length / Math.max(1, Math.floor((w - pad.l) / 34)));
      if (i % every === 0) {
        ctx.fillStyle = css('--muted'); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(b.label, cx, h - 6);
      }
    });
    ctx.strokeStyle = css('--muted'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, Math.round(zero) + 0.5); ctx.lineTo(w - pad.r, Math.round(zero) + 0.5); ctx.stroke();
    if (!hit) { tip.hidden = true; return; }
    tip.hidden = false;
    const wr = hit.b.trades ? Math.round((hit.b.wins / hit.b.trades) * 100) : null;
    tip.innerHTML = `<b>${esc(hit.b.full || hit.b.label)}</b><span class="${cls(hit.b.value)}">${esc(money(hit.b.value, true))}</span>`
      + `<span>${esc(L('tradesCount', { n: hit.b.trades }))}${wr != null ? ` · ${wr}%` : ''}</span>`;
    tip.style.left = `${Math.max(0, Math.min(hit.cx + 8, w - tip.offsetWidth - 4))}px`;
    tip.style.top = `${Math.max(0, hit.top - tip.offsetHeight - 6)}px`;
  };
  const indexAt = (e) => {
    const pad = 56, slot = (canvas.clientWidth - pad - 8) / items.length;
    const i = Math.floor((e.offsetX - pad) / slot);
    return i >= 0 && i < items.length ? i : null;
  };
  canvas.onmousemove = (e) => draw(indexAt(e));
  canvas.onmouseleave = () => draw(null);
  draw(null);
  return draw;
}

// --- panel ------------------------------------------------------------------
export class BacktestPanel {
  constructor({ toast = () => {} } = {}) {
    this.toast = toast;
    this.journal = new Journal(null, { onChange: (d) => this.scheduleSave(d) });
    this.ready = adapter.load().then((data) => {
      this.journal = new Journal(data, { onChange: (d) => this.scheduleSave(d) });
      if (!data) this.scheduleSave(this.journal.data);
    });
    this.tab = 'dashboard';
    this.filters = { sessionId: '', symbol: '', side: '', outcome: '', from: '', to: '', breakeven: 0, allStrategies: false };
    this.saveTimer = null;
    this.redraws = [];
    this.build();
    window.addEventListener('resize', () => { if (!this.el.hidden) this.redraws.forEach((f) => f()); });
    window.addEventListener('beforeunload', () => this.flush());
  }

  scheduleSave(data) {
    clearTimeout(this.saveTimer);
    this.pending = data;
    this.saveTimer = setTimeout(() => this.flush(), 400);
    if (!this.el.hidden) this.render();
  }
  flush() {
    clearTimeout(this.saveTimer);
    if (this.pending) { adapter.save(this.pending); this.pending = null; }
  }

  // --- grabación desde el replay (trading.js) ---------------------------------
  /** Balance con el que empezará el próximo replay si continúa una sesión (o null). */
  nextBalance() {
    const s = this.journal.continueSession;
    return s ? this.journal.balanceOf(s.id) : null;
  }
  startSession({ symbol, tf, startBalance, replayFrom }) {
    return this.journal.startSession({ symbol, tf, startBalance, replayFrom }).id;
  }
  recordTrade(sessionId, trade) { return this.journal.addTrade(sessionId, trade); }
  endSession(sessionId, info) { this.journal.endSession(sessionId, info); this.flush(); }

  // --- interfaz ---------------------------------------------------------------
  build() {
    const el = document.createElement('section');
    el.className = 'bt-overlay';
    el.hidden = true;
    el.setAttribute('aria-label', L('title'));
    el.innerHTML = `
      <div class="bt-head">
        <span class="bt-title">${esc(L('title'))}</span>
        <label class="bt-pick"><span>${esc(L('user'))}</span><select class="field" data-bt="user"></select></label>
        <button type="button" class="tb-btn" data-bt-act="user-menu" title="${esc(L('user'))}">⋯</button>
        <label class="bt-pick"><span>${esc(L('strategy'))}</span><select class="field" data-bt="strategy"></select></label>
        <button type="button" class="tb-btn" data-bt-act="strategy-menu" title="${esc(L('strategy'))}">⋯</button>
        <span class="spacer"></span>
        <div class="bt-tabs" role="tablist">
          ${['dashboard', 'sessions', 'trades', 'strategies'].map((k) => `<button type="button" class="bt-tab" data-bt-tab="${k}">${esc(L(k))}</button>`).join('')}
        </div>
        <button type="button" class="tb-btn icon bt-close" data-bt-act="close" title="${esc(L('close'))}" aria-label="${esc(L('close'))}">×</button>
      </div>
      <div class="bt-menu menu" hidden></div>
      <div class="bt-filters"></div>
      <div class="bt-body"></div>
      <input type="file" accept="application/json,.json" class="bt-file" hidden>
      <form class="bt-ask" hidden><label><span class="bt-ask-label"></span><textarea class="field" rows="1" maxlength="4000"></textarea></label>
        <div class="pop-actions"><button type="button" class="btn-ghost" data-ask="cancel">${esc(L('close'))}</button><button type="submit" class="btn-primary">OK</button></div></form>`;
    document.body.appendChild(el);
    this.el = el;
    this.body = el.querySelector('.bt-body');
    this.menu = el.querySelector('.bt-menu');

    el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { if (!this.menu.hidden) this.menu.hidden = true; else this.close(); } });
    el.addEventListener('change', (e) => this.onChange(e));
    el.addEventListener('click', (e) => this.onClick(e));
    el.querySelector('.bt-file').addEventListener('change', (e) => this.importFile(e.target.files?.[0]));
    document.addEventListener('mousedown', (e) => { if (!this.menu.hidden && !this.menu.contains(e.target) && !e.target.closest('[data-bt-act$="-menu"]')) this.menu.hidden = true; });
  }

  async open(tab = null) {
    await this.ready;
    if (tab) this.tab = tab;
    this.el.hidden = false;
    this.render();
  }
  close() { this.el.hidden = true; this.menu.hidden = true; this.flush(); }
  toggle() { if (this.el.hidden) this.open(); else this.close(); }

  query() {
    const f = this.filters;
    return this.journal.query({
      strategyId: f.allStrategies ? null : this.journal.data.activeStrategyId,
      sessionId: f.sessionId || null, symbol: f.symbol || null, side: f.side || null, outcome: f.outcome || null,
      from: dayInput(f.from, false), to: dayInput(f.to, true), breakeven: f.breakeven,
    });
  }

  render() {
    const j = this.journal;
    const userSel = this.el.querySelector('[data-bt="user"]');
    userSel.innerHTML = j.users.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
    userSel.value = j.data.activeUserId;
    const stratSel = this.el.querySelector('[data-bt="strategy"]');
    stratSel.innerHTML = j.strategiesOf().map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    stratSel.value = j.data.activeStrategyId;
    this.el.querySelectorAll('[data-bt-tab]').forEach((b) => b.classList.toggle('on', b.dataset.btTab === this.tab));
    this.renderFilters();
    this.redraws = [];
    if (this.tab === 'dashboard') this.renderDashboard();
    else if (this.tab === 'sessions') this.renderSessions();
    else if (this.tab === 'trades') this.renderTrades();
    else this.renderStrategies();
  }

  renderFilters() {
    const j = this.journal, f = this.filters;
    const box = this.el.querySelector('.bt-filters');
    if (this.tab === 'strategies') { box.innerHTML = `<span class="muted">${esc(L('hint'))}</span>`; return; }
    const sessions = j.sessionsOf({ strategyId: f.allStrategies ? null : j.data.activeStrategyId });
    const symbols = [...new Set(j.query({ strategyId: f.allStrategies ? null : j.data.activeStrategyId }).map((t) => t.symbol))].sort();
    if (f.sessionId && !sessions.some((s) => s.id === f.sessionId)) f.sessionId = '';
    const opt = (v, label, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
    box.innerHTML = `
      <label class="menu-check bt-all"><input type="checkbox" data-f="allStrategies"${f.allStrategies ? ' checked' : ''}> ${esc(L('allStrategies'))}</label>
      <select class="field" data-f="sessionId">${opt('', L('allSessions'), f.sessionId)}${sessions.map((s) => opt(s.id, s.name, f.sessionId)).join('')}</select>
      <select class="field" data-f="symbol">${opt('', L('allSymbols'), f.symbol)}${symbols.map((s) => opt(s, s.split(':').pop(), f.symbol)).join('')}</select>
      <select class="field" data-f="side" aria-label="${esc(L('side'))}">${opt('', `${L('side')}: ${L('both')}`, f.side)}${opt('long', L('long'), f.side)}${opt('short', L('short'), f.side)}</select>
      <select class="field" data-f="outcome" aria-label="${esc(L('outcome'))}">${opt('', `${L('outcome')}: ${L('all')}`, f.outcome)}${opt('win', L('win'), f.outcome)}${opt('loss', L('loss'), f.outcome)}${opt('be', L('be'), f.outcome)}</select>
      <label class="bt-date">${esc(L('from'))}<input class="field" type="date" data-f="from" value="${esc(f.from)}"></label>
      <label class="bt-date">${esc(L('to'))}<input class="field" type="date" data-f="to" value="${esc(f.to)}"></label>
      <label class="bt-date" title="${esc(L('beThreshold'))}">BE $<input class="field bt-be" type="number" min="0" step="any" data-f="breakeven" value="${esc(String(f.breakeven || 0))}"></label>
      <button type="button" class="tb-btn" data-bt-act="clear">${esc(L('clear'))}</button>
      <span class="spacer"></span>
      <button type="button" class="tb-btn" data-bt-act="csv">${esc(L('exportCsv'))}</button>
      <button type="button" class="tb-btn" data-bt-act="json">${esc(L('exportJson'))}</button>
      <button type="button" class="tb-btn" data-bt-act="import">${esc(L('importJson'))}</button>`;
  }

  renderDashboard() {
    const trades = this.query();
    const f = this.filters;
    const start = this.journal.startBalanceFor({ sessionId: f.sessionId || null, strategyId: f.allStrategies ? null : this.journal.data.activeStrategyId });
    const s = computeStats(trades, start, { breakeven: f.breakeven, tzOffset: tzOff() });
    const cont = this.journal.continueSession;
    const head = `<div class="bt-next"><b>${esc(L('nextReplay'))}:</b> ${esc(this.journal.activeUser?.name || '')} · ${esc(this.journal.activeStrategy?.name || '')} · ${cont ? `${esc(L('continuing'))} «${esc(cont.name)}» (${esc(money(this.journal.balanceOf(cont.id)))})` : esc(L('newSession'))}</div>`;
    if (!trades.length) { this.body.innerHTML = `${head}<div class="bt-empty">${esc(L('empty'))}</div>`; return; }
    const tile = (label, value, sub = '', c = '') => `<div class="bt-kpi"><span>${esc(label)}</span><b class="${c}">${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const day = (d) => (d ? `${esc(dateText(d[0] - tzOff(), false))} · <span class="${cls(d[1].pnl)}">${esc(money(d[1].pnl, true))}</span>` : '—');
    this.body.innerHTML = `${head}
      <div class="bt-kpis">
        ${tile(L('totalPnl'), esc(money(s.net, true)), esc(pct(s.netPct, 2, true)), cls(s.net))}
        ${tile(L('balance'), esc(money(s.balance)), esc(`${L('from')} ${money(s.startBalance)}`))}
        ${tile(L('winRate'), esc(pct(s.winRate, 1)), esc(L('winsLosses', { w: s.wins, l: s.losses }) + (s.breakeven ? ` / ${s.breakeven} BE` : '')))}
        ${tile(L('tradesN'), esc(String(s.trades)), esc(`${L('tradingDays')}: ${s.tradingDays}`))}
        ${tile(L('pf'), esc(num(s.profitFactor)))}
        ${tile(L('rr'), esc(num(s.avgRR)), esc(`${L('avgWin')} ${money(s.avgWin)} · ${L('avgLoss')} ${money(s.avgLoss)}`))}
        ${tile(L('expectancy'), esc(money(s.expectancy, true)), '', cls(s.expectancy))}
        ${tile(L('avgR'), esc(s.avgR == null ? '—' : `${num(s.avgR)}R`), esc(s.totalR == null ? '' : `Σ ${num(s.totalR, 1)}R`), cls(s.avgR))}
        ${tile(L('maxDD'), esc(money(-s.maxDrawdown)), esc(pct(-s.maxDrawdownPct)), s.maxDrawdown ? 'down' : '')}
        ${tile(L('recovery'), esc(num(s.recoveryFactor)))}
        ${tile(L('largestWin'), esc(money(s.largestWin, true)), '', 'up')}
        ${tile(L('largestLoss'), esc(money(s.largestLoss, true)), '', 'down')}
        ${tile(L('streaks'), esc(`${s.maxConsecWins} / ${s.maxConsecLosses}`))}
        ${tile(L('sharpe'), esc(num(s.sharpe)))}
        ${tile(L('duration'), esc(dur(s.avgDuration)))}
        ${tile(L('dayAvg'), esc(money(s.avgDaily, true)), esc(`${L('weekAvg')} ${money(s.avgWeekly, true)}`), cls(s.avgDaily))}
        ${tile(L('monthAvg'), esc(money(s.avgMonthly, true)), '', cls(s.avgMonthly))}
        ${tile(L('longs'), esc(money(s.longs.pnl, true)), esc(`${s.longs.trades} · ${s.longs.trades ? Math.round((s.longs.wins / s.longs.trades) * 100) : 0}%`), cls(s.longs.pnl))}
        ${tile(L('shorts'), esc(money(s.shorts.pnl, true)), esc(`${s.shorts.trades} · ${s.shorts.trades ? Math.round((s.shorts.wins / s.shorts.trades) * 100) : 0}%`), cls(s.shorts.pnl))}
        ${tile(L('bestDay'), day(s.bestDay))}
        ${tile(L('worstDay'), day(s.worstDay))}
      </div>
      <div class="bt-charts">
        <div class="bt-card bt-wide"><h4>${esc(L('equity'))}</h4><div class="bt-chart"><canvas data-chart="equity"></canvas><div class="bt-tip" hidden></div></div></div>
        <div class="bt-card"><h4>${esc(L('byWeekday'))}</h4><div class="bt-chart"><canvas data-chart="weekday"></canvas><div class="bt-tip" hidden></div></div></div>
        <div class="bt-card"><h4>${esc(L('byHour'))}</h4><div class="bt-chart"><canvas data-chart="hour"></canvas><div class="bt-tip" hidden></div></div></div>
        <div class="bt-card"><h4>${esc(L('byMonth'))}</h4><div class="bt-chart"><canvas data-chart="month"></canvas><div class="bt-tip" hidden></div></div></div>
        <div class="bt-card"><h4>${esc(L('bySymbol'))}</h4>${this.symbolTable(s)}</div>
      </div>`;
    const chart = (key) => {
      const c = this.body.querySelector(`[data-chart="${key}"]`);
      return [c, c.nextElementSibling];
    };
    const days = L('days');
    const wk = s.byWeekday.map((b, i) => ({ label: days[i], value: b.pnl, trades: b.trades, wins: b.wins })).filter((b, i) => i < 5 || b.trades);
    const hr = s.byHour.map((b, i) => ({ label: String(i).padStart(2, '0'), full: `${String(i).padStart(2, '0')}:00`, value: b.pnl, trades: b.trades, wins: b.wins }));
    const mo = s.byMonth.map(([k, b]) => ({ label: k.slice(2).replace('-', '/'), full: k, value: b.pnl, trades: b.trades, wins: b.wins }));
    this.redraws.push(
      drawEquity(...chart('equity'), s.curve),
      drawBars(...chart('weekday'), wk),
      drawBars(...chart('hour'), hr),
      drawBars(...chart('month'), mo),
    );
  }

  symbolTable(s) {
    return `<table class="bt-table"><thead><tr><th>${esc(L('symbol'))}</th><th>${esc(L('tradesN'))}</th><th>${esc(L('winRate'))}</th><th>${esc(L('pnl'))}</th></tr></thead><tbody>
      ${s.bySymbol.map(([sym, b]) => `<tr><td>${esc(sym.split(':').pop())}</td><td>${b.trades}</td><td>${pct((b.wins / b.trades) * 100, 0)}</td><td class="${cls(b.pnl)}">${esc(money(b.pnl, true))}</td></tr>`).join('')}
    </tbody></table>`;
  }

  renderSessions() {
    const j = this.journal, f = this.filters;
    const list = j.sessionsOf({ strategyId: f.allStrategies ? null : j.data.activeStrategyId });
    if (!list.length) { this.body.innerHTML = `<div class="bt-empty">${esc(L('noSessions'))} ${esc(L('empty'))}</div>`; return; }
    const strat = new Map(j.data.strategies.map((s) => [s.id, s.name]));
    const cont = j.data.continueSessionId;
    this.body.innerHTML = `<table class="bt-table bt-sessions"><thead><tr>
        <th>${esc(L('sessionName'))}</th><th>${esc(L('strategy'))}</th><th>${esc(L('symbol'))}</th><th>${esc(L('tf'))}</th><th>${esc(L('period'))}</th>
        <th>${esc(L('tradesN'))}</th><th>${esc(L('winRate'))}</th><th>${esc(L('pnl'))}</th><th>${esc(L('balance'))}</th><th>${esc(L('updated'))}</th><th></th></tr></thead><tbody>
      ${list.map((s) => {
        const tr = j.query({ sessionId: s.id });
        const st = computeStats(tr, s.startBalance, { breakeven: f.breakeven });
        return `<tr data-session="${esc(s.id)}"${s.id === cont ? ' class="on"' : ''}>
          <td><b>${esc(s.name)}</b>${s.status === 'running' ? ` <small class="muted">(${esc(L('running'))})</small>` : ''}</td>
          <td>${esc(strat.get(s.strategyId) || '')}</td><td>${esc(s.symbol.split(':').pop())}</td><td>${esc(s.tf)}</td>
          <td>${esc(dateText(s.replayFrom, false))} → ${esc(dateText(s.replayTo, false))}</td>
          <td>${st.trades}</td><td>${esc(pct(st.winRate, 0))}</td><td class="${cls(st.net)}">${esc(money(st.net, true))}</td>
          <td>${esc(money(st.balance))}</td><td>${esc(new Date(s.updatedAt).toLocaleDateString(locale))}</td>
          <td class="bt-actions">
            <button type="button" class="tb-btn" data-s-act="view">${esc(L('view'))}</button>
            <button type="button" class="tb-btn${s.id === cont ? ' on' : ''}" data-s-act="continue">${esc(s.id === cont ? L('continuing') : L('continueS'))}</button>
            <button type="button" class="tb-btn" data-s-act="rename">${esc(L('rename'))}</button>
            <button type="button" class="tb-btn" data-s-act="delete">${esc(L('del'))}</button>
          </td></tr>`;
      }).join('')}</tbody></table>`;
  }

  renderTrades() {
    const trades = this.query().slice().reverse();
    if (!trades.length) { this.body.innerHTML = `<div class="bt-empty">${esc(L('empty'))}</div>`; return; }
    const fmtP = (v) => (v == null ? '—' : v.toLocaleString(locale, { maximumFractionDigits: Math.abs(v) >= 100 ? 2 : Math.abs(v) >= 1 ? 4 : 6 }));
    this.body.innerHTML = `<table class="bt-table bt-trades"><thead><tr>
        <th>${esc(L('date'))}</th><th>${esc(L('symbol'))}</th><th>${esc(L('side'))}</th><th>${esc(L('qty'))}</th><th>${esc(L('entry'))}</th><th>${esc(L('exit'))}</th>
        <th>SL / TP</th><th>${esc(L('pnl'))}</th><th>${esc(L('r'))}</th><th>${esc(L('reason'))}</th><th>${esc(L('setup'))}</th><th>${esc(L('tags'))}</th><th>${esc(L('notes'))}</th><th></th></tr></thead><tbody>
      ${trades.slice(0, 2000).map((t) => `<tr data-trade="${esc(t.id)}">
        <td>${esc(dateText(t.exitTime))}</td><td>${esc(t.symbol.split(':').pop())}</td>
        <td class="${t.side === 'long' ? 'up' : 'down'}">${esc(t.side === 'long' ? L('long') : L('short'))}</td>
        <td>${esc(String(t.qty))}</td><td>${esc(fmtP(t.entry))}</td><td>${esc(fmtP(t.exit))}</td>
        <td class="muted">${esc(fmtP(t.sl))} / ${esc(fmtP(t.tp))}</td>
        <td class="${cls(t.pnl)}">${esc(money(t.pnl, true))}</td><td class="${cls(t.r)}">${esc(t.r == null ? '—' : `${num(t.r)}R`)}</td>
        <td>${esc(t.reason || '')}</td>
        <td><button type="button" class="link-btn" data-t-act="setup">${esc(t.setup || '+')}</button></td>
        <td><button type="button" class="link-btn" data-t-act="tags">${esc(t.tags.join(', ') || '+')}</button></td>
        <td class="bt-notes"><button type="button" class="link-btn" data-t-act="notes" title="${esc(t.notes)}">${esc(t.notes ? t.notes.slice(0, 40) + (t.notes.length > 40 ? '…' : '') : '+')}</button></td>
        <td><button type="button" class="tb-btn" data-t-act="delete" title="${esc(L('del'))}">×</button></td>
      </tr>`).join('')}</tbody></table>`;
  }

  renderStrategies() {
    const j = this.journal;
    const list = j.strategiesOf(undefined, { archived: true });
    this.body.innerHTML = `<div class="bt-strats">${list.map((s) => {
      const tr = j.query({ strategyId: s.id });
      const st = computeStats(tr, j.startBalanceFor({ strategyId: s.id }));
      const n = j.sessionsOf({ strategyId: s.id }).length;
      return `<div class="bt-card bt-strat${s.id === j.data.activeStrategyId ? ' on' : ''}${s.archived ? ' archived' : ''}" data-strategy="${esc(s.id)}">
        <h4>${esc(s.name)}${s.archived ? ` <small class="muted">(${esc(L('archived'))})</small>` : ''}</h4>
        <p class="muted bt-desc">${esc(s.description || '—')}</p>
        <div class="bt-strat-kpis"><span>${n} ${esc(L('sessionsShort'))}</span><span>${st.trades} ${esc(L('tradesN').toLowerCase())}</span>
          <span>${esc(L('winRate'))} ${esc(pct(st.winRate, 0))}</span><span class="${cls(st.net)}">${esc(money(st.net, true))}</span></div>
        <div class="bt-actions">
          <button type="button" class="tb-btn" data-st-act="use">${esc(L('view'))}</button>
          <button type="button" class="tb-btn" data-st-act="edit">${esc(L('edit'))}</button>
          <button type="button" class="tb-btn" data-st-act="archive">${esc(s.archived ? L('unarchive') : L('archive'))}</button>
        </div></div>`;
    }).join('')}
      <button type="button" class="bt-card bt-add" data-bt-act="new-strategy">+ ${esc(L('newStrategy'))}</button></div>`;
  }

  // --- eventos -------------------------------------------------------------------
  onChange(e) {
    const j = this.journal;
    if (e.target.matches('[data-bt="user"]')) { j.setActiveUser(e.target.value); this.filters.sessionId = ''; return; }
    if (e.target.matches('[data-bt="strategy"]')) { j.setActiveStrategy(e.target.value); this.filters.sessionId = ''; return; }
    const key = e.target.dataset.f;
    if (!key) return;
    this.filters[key] = key === 'allStrategies' ? e.target.checked : key === 'breakeven' ? Math.max(0, Number(e.target.value) || 0) : e.target.value;
    this.render();
  }

  showMenu(anchor, items) {
    this.menu.innerHTML = items.map(([act, label]) => `<button type="button" class="layout-opt" data-m-act="${act}">${esc(label)}</button>`).join('');
    this.menu.hidden = false;
    const r = anchor.getBoundingClientRect();
    this.menu.style.left = `${Math.min(r.left, window.innerWidth - this.menu.offsetWidth - 8)}px`;
    this.menu.style.top = `${r.bottom + 4}px`;
  }

  async onClick(e) {
    const j = this.journal;
    const tab = e.target.closest('[data-bt-tab]')?.dataset.btTab;
    if (tab) { this.tab = tab; this.render(); return; }
    const act = e.target.closest('[data-bt-act]')?.dataset.btAct;
    const mact = e.target.closest('[data-m-act]')?.dataset.mAct;
    if (act === 'close') return this.close();
    if (act === 'user-menu') return this.showMenu(e.target, [['new-user', L('newUser')], ['rename-user', L('rename')], ['delete-user', L('del')]]);
    if (act === 'strategy-menu') return this.showMenu(e.target, [['new-strategy', L('newStrategy')], ['edit-strategy', L('edit')]]);
    if (mact) this.menu.hidden = true;
    const action = act || mact;
    if (action === 'new-user') { const n = await this.ask(L('namePrompt')); if (n?.trim()) j.addUser(n); return; }
    if (action === 'rename-user') { const n = await this.ask(L('namePrompt'), j.activeUser?.name); if (n?.trim()) j.renameUser(j.data.activeUserId, n); return; }
    if (action === 'delete-user') { const u = j.activeUser; if (u && j.users.length > 1 && confirm(L('confirmDelUser', { name: u.name }))) j.deleteUser(u.id); return; }
    if (action === 'new-strategy') { const n = await this.ask(L('namePrompt')); if (n?.trim()) { const d = await this.ask(L('descPrompt')) || ''; j.addStrategy(n, d); } return; }
    if (action === 'edit-strategy') return this.editStrategy(j.data.activeStrategyId);
    if (action === 'clear') { this.filters = { ...this.filters, sessionId: '', symbol: '', side: '', outcome: '', from: '', to: '', breakeven: 0 }; return this.render(); }
    if (action === 'csv') return this.download(`albertoscharts-trades-${new Date().toISOString().slice(0, 10)}.csv`, j.tradesCSV(this.query()), 'text/csv');
    if (action === 'json') return this.download(`albertoscharts-journal-${new Date().toISOString().slice(0, 10)}.json`, j.exportJSON(), 'application/json');
    if (action === 'import') return this.el.querySelector('.bt-file').click();

    const row = e.target.closest('[data-session]');
    const sact = e.target.closest('[data-s-act]')?.dataset.sAct;
    if (row && sact) {
      const s = j.session(row.dataset.session);
      if (!s) return;
      if (sact === 'view') { this.filters.sessionId = s.id; this.filters.allStrategies = s.strategyId !== j.data.activeStrategyId; this.tab = 'dashboard'; return this.render(); }
      if (sact === 'continue') {
        if (s.strategyId !== j.data.activeStrategyId) j.setActiveStrategy(s.strategyId);
        return j.setContinueSession(j.data.continueSessionId === s.id ? null : s.id);
      }
      if (sact === 'rename') { const n = await this.ask(L('namePrompt'), s.name); if (n?.trim()) j.renameSession(s.id, n); return; }
      if (sact === 'delete' && confirm(L('confirmDelSession', { name: s.name, n: j.query({ sessionId: s.id }).length }))) j.deleteSession(s.id);
      return;
    }
    const trow = e.target.closest('[data-trade]');
    const tact = e.target.closest('[data-t-act]')?.dataset.tAct;
    if (trow && tact) {
      const t = j.data.trades.find((x) => x.id === trow.dataset.trade);
      if (!t) return;
      if (tact === 'notes') { const v = await this.ask(L('notesPrompt'), t.notes); if (v != null) j.updateTrade(t.id, { notes: v }); }
      else if (tact === 'tags') { const v = await this.ask(L('tagsPrompt'), t.tags.join(', ')); if (v != null) j.updateTrade(t.id, { tags: v }); }
      else if (tact === 'setup') { const v = await this.ask(L('setupPrompt'), t.setup); if (v != null) j.updateTrade(t.id, { setup: v }); }
      else if (tact === 'delete' && confirm(L('confirmDelTrade'))) j.deleteTrade(t.id);
      return;
    }
    const card = e.target.closest('[data-strategy]');
    const stact = e.target.closest('[data-st-act]')?.dataset.stAct;
    if (card && stact) {
      const id = card.dataset.strategy;
      if (stact === 'use') { j.setActiveStrategy(id); this.filters.allStrategies = false; this.tab = 'dashboard'; return this.render(); }
      if (stact === 'edit') return this.editStrategy(id);
      if (stact === 'archive') { const s = j.data.strategies.find((x) => x.id === id); j.updateStrategy(id, { archived: !s.archived }); }
    }
  }

  /** Pide un texto en un diálogo propio (Electron no tiene window.prompt). Resuelve null si se cancela. */
  ask(label, value = '') {
    const form = this.el.querySelector('.bt-ask');
    const area = form.querySelector('textarea');
    form.querySelector('.bt-ask-label').textContent = label;
    area.value = value ?? '';
    area.rows = /descrip|notas|notes|rules|reglas/i.test(label) ? 5 : 1;
    form.hidden = false;
    area.focus();
    area.select();
    return new Promise((resolve) => {
      const done = (v) => { form.hidden = true; form.onsubmit = null; form.onclick = null; area.onkeydown = null; resolve(v); };
      form.onsubmit = (e) => { e.preventDefault(); done(area.value); };
      form.onclick = (e) => { if (e.target.closest('[data-ask="cancel"]')) done(null); };
      area.onkeydown = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
        else if (e.key === 'Enter' && area.rows === 1) { e.preventDefault(); done(area.value); }
      };
    });
  }

  async editStrategy(id) {
    const s = this.journal.data.strategies.find((x) => x.id === id);
    if (!s) return;
    const n = await this.ask(L('namePrompt'), s.name);
    if (n == null) return;
    const d = await this.ask(L('descPrompt'), s.description);
    this.journal.updateStrategy(id, { name: n, description: d ?? s.description });
  }

  download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async importFile(file) {
    if (!file) return;
    try {
      const r = this.journal.importJSON(await file.text());
      this.toast(L('imported', { s: r.sessions, t: r.trades }));
    } catch (err) {
      this.toast(L('importFail', { e: err.message }));
    }
    this.el.querySelector('.bt-file').value = '';
  }
}
