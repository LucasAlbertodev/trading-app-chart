// Journal de trading: usuarios, estrategias, sesiones y operaciones.
//
// Hoy lo alimenta el backtesting (cada replay es una sesión y cada operación cerrada en él queda
// guardada). El esquema ya contempla el journal completo que vendrá después:
//   - session.type / trade.type: 'backtest' hoy; 'paper', 'live' y 'prop' más adelante.
//   - trade.tags, trade.notes, trade.setup, trade.emotion, trade.screenshots: para anotar cada operación.
//   - version + migrate(): cada cambio de esquema se migra al cargar, sin perder datos.
// Sin DOM ni red: lo prueban los tests (test/journal.test.mjs). La persistencia va aparte
// (adapters: archivo en la app de escritorio, localStorage en el navegador).

export const JOURNAL_VERSION = 1;
const MAX_TRADES = 200000;

const now = () => Date.now();
const uid = (p) => `${p}_${now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function emptyJournal() {
  const user = { id: uid('u'), name: 'Principal', createdAt: now() };
  const strategy = { id: uid('s'), userId: user.id, name: 'General', description: '', createdAt: now(), archived: false };
  return {
    version: JOURNAL_VERSION,
    activeUserId: user.id,
    activeStrategyId: strategy.id,
    continueSessionId: null, // sesión a continuar en el próximo replay (null = nueva)
    users: [user],
    strategies: [strategy],
    sessions: [],
    trades: [],
  };
}

/** Lleva un journal guardado (cualquier versión) al esquema actual; descarta lo que no sea válido. */
export function migrate(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.users)) return emptyJournal();
  const j = {
    version: JOURNAL_VERSION,
    activeUserId: raw.activeUserId ?? null,
    activeStrategyId: raw.activeStrategyId ?? null,
    continueSessionId: raw.continueSessionId ?? null,
    users: raw.users.filter((u) => u && u.id).map((u) => ({ id: String(u.id), name: str(u.name, 60) || 'Usuario', createdAt: num(u.createdAt) ?? now() })),
    strategies: (raw.strategies || []).filter((s) => s && s.id).map((s) => ({
      id: String(s.id), userId: String(s.userId), name: str(s.name, 80) || 'Estrategia', description: str(s.description, 4000),
      createdAt: num(s.createdAt) ?? now(), archived: !!s.archived,
    })),
    sessions: (raw.sessions || []).filter((s) => s && s.id).map((s) => ({
      id: String(s.id), type: s.type || 'backtest', userId: String(s.userId), strategyId: String(s.strategyId),
      name: str(s.name, 120), symbol: str(s.symbol, 100), tf: str(s.tf, 10),
      startBalance: num(s.startBalance) ?? 100000, endBalance: num(s.endBalance),
      replayFrom: num(s.replayFrom), replayTo: num(s.replayTo),
      createdAt: num(s.createdAt) ?? now(), updatedAt: num(s.updatedAt) ?? now(),
      status: s.status === 'running' ? 'running' : 'done', notes: str(s.notes, 4000),
    })),
    trades: (raw.trades || []).filter((t) => t && t.id && num(t.pnl) != null).slice(-MAX_TRADES).map(cleanTrade),
  };
  if (!j.users.length) return emptyJournal();
  if (!j.users.some((u) => u.id === j.activeUserId)) j.activeUserId = j.users[0].id;
  if (!j.strategies.some((s) => s.userId === j.activeUserId)) {
    j.strategies.push({ id: uid('s'), userId: j.activeUserId, name: 'General', description: '', createdAt: now(), archived: false });
  }
  if (!j.strategies.some((s) => s.id === j.activeStrategyId && s.userId === j.activeUserId)) {
    j.activeStrategyId = j.strategies.find((s) => s.userId === j.activeUserId).id;
  }
  // Una sesión que quedó "en curso" (la app se cerró en medio de un replay) pasa a terminada.
  for (const s of j.sessions) if (s.status === 'running') s.status = 'done';
  if (!j.sessions.some((s) => s.id === j.continueSessionId)) j.continueSessionId = null;
  return j;
}

function cleanTrade(t) {
  return {
    id: String(t.id), type: t.type || 'backtest',
    sessionId: String(t.sessionId), userId: String(t.userId), strategyId: String(t.strategyId),
    symbol: str(t.symbol, 100), side: t.side === 'short' ? 'short' : 'long',
    qty: num(t.qty) ?? 0, entry: num(t.entry), exit: num(t.exit), pnl: num(t.pnl) ?? 0, pnlPct: num(t.pnlPct),
    entryTime: num(t.entryTime), exitTime: num(t.exitTime), reason: str(t.reason, 40),
    sl: num(t.sl), tp: num(t.tp), commission: num(t.commission) ?? 0,
    risk: num(t.risk), r: num(t.r),
    tags: Array.isArray(t.tags) ? t.tags.map((x) => str(x, 40)).filter(Boolean).slice(0, 20) : [],
    notes: str(t.notes, 4000), setup: str(t.setup, 80), emotion: str(t.emotion, 40),
    screenshots: Array.isArray(t.screenshots) ? t.screenshots.slice(0, 10).map((x) => str(x, 400)) : [],
    createdAt: num(t.createdAt) ?? now(),
  };
}

/** Riesgo inicial ($) y múltiplo R de una operación con stop. */
export function riskOf(t) {
  if (t.sl == null || t.entry == null || !t.qty) return { risk: null, r: null };
  const risk = Math.abs(t.entry - t.sl) * Math.abs(t.qty);
  return risk > 0 ? { risk, r: t.pnl / risk } : { risk: null, r: null };
}

export class Journal {
  constructor(data = null, { onChange } = {}) {
    this.data = migrate(data);
    this.onChange = onChange;
  }

  changed() { this.onChange?.(this.data); }
  toJSON() { return this.data; }

  // --- usuarios y estrategias ------------------------------------------------
  get users() { return this.data.users; }
  get activeUser() { return this.data.users.find((u) => u.id === this.data.activeUserId); }
  strategiesOf(userId = this.data.activeUserId, { archived = false } = {}) {
    return this.data.strategies.filter((s) => s.userId === userId && (archived || !s.archived));
  }
  get activeStrategy() { return this.data.strategies.find((s) => s.id === this.data.activeStrategyId); }

  addUser(name) {
    const u = { id: uid('u'), name: str(name, 60) || 'Usuario', createdAt: now() };
    this.data.users.push(u);
    this.data.strategies.push({ id: uid('s'), userId: u.id, name: 'General', description: '', createdAt: now(), archived: false });
    this.setActiveUser(u.id);
    return u;
  }

  renameUser(id, name) {
    const u = this.data.users.find((x) => x.id === id);
    if (u && str(name, 60)) { u.name = str(name, 60); this.changed(); }
  }

  /** Borra un usuario con todas sus estrategias, sesiones y operaciones (no el último). */
  deleteUser(id) {
    if (this.data.users.length <= 1) return false;
    this.data.users = this.data.users.filter((u) => u.id !== id);
    this.data.strategies = this.data.strategies.filter((s) => s.userId !== id);
    this.data.sessions = this.data.sessions.filter((s) => s.userId !== id);
    this.data.trades = this.data.trades.filter((t) => t.userId !== id);
    if (this.data.activeUserId === id) this.setActiveUser(this.data.users[0].id, false);
    this.changed();
    return true;
  }

  setActiveUser(id, notify = true) {
    if (!this.data.users.some((u) => u.id === id)) return;
    this.data.activeUserId = id;
    const s = this.strategiesOf(id)[0] || this.addStrategy('General', '', false);
    this.data.activeStrategyId = s.id;
    this.data.continueSessionId = null;
    if (notify) this.changed();
  }

  addStrategy(name, description = '', notify = true) {
    const s = { id: uid('s'), userId: this.data.activeUserId, name: str(name, 80) || 'Estrategia', description: str(description, 4000), createdAt: now(), archived: false };
    this.data.strategies.push(s);
    this.data.activeStrategyId = s.id;
    this.data.continueSessionId = null;
    if (notify) this.changed();
    return s;
  }

  updateStrategy(id, patch) {
    const s = this.data.strategies.find((x) => x.id === id);
    if (!s) return;
    if (patch.name != null && str(patch.name, 80)) s.name = str(patch.name, 80);
    if (patch.description != null) s.description = str(patch.description, 4000);
    if (patch.archived != null) s.archived = !!patch.archived;
    this.changed();
  }

  setActiveStrategy(id) {
    if (!this.strategiesOf().some((s) => s.id === id)) return;
    this.data.activeStrategyId = id;
    this.data.continueSessionId = null;
    this.changed();
  }

  // --- sesiones --------------------------------------------------------------
  sessionsOf({ userId = this.data.activeUserId, strategyId = null } = {}) {
    return this.data.sessions.filter((s) => s.userId === userId && (!strategyId || s.strategyId === strategyId))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  session(id) { return this.data.sessions.find((s) => s.id === id) || null; }

  /** La sesión que el próximo replay continuará (de la estrategia activa), o null. */
  get continueSession() {
    const s = this.session(this.data.continueSessionId);
    return s && s.strategyId === this.data.activeStrategyId ? s : null;
  }

  setContinueSession(id) {
    this.data.continueSessionId = id && this.session(id) ? id : null;
    this.changed();
  }

  /**
   * Un replay empieza: abre una sesión nueva (o continúa la elegida). Devuelve la sesión; su
   * balance actual es el inicial del replay.
   */
  startSession({ symbol, tf, startBalance, replayFrom = null }) {
    let s = this.continueSession;
    if (s) {
      s.status = 'running';
      s.updatedAt = now();
      this.data.continueSessionId = null;
    } else {
      const strat = this.activeStrategy;
      s = {
        id: uid('ses'), type: 'backtest', userId: this.data.activeUserId, strategyId: strat.id,
        name: `${strat.name} · ${symbol.split(':').pop()} ${tf}`, symbol, tf,
        startBalance, endBalance: startBalance, replayFrom, replayTo: replayFrom,
        createdAt: now(), updatedAt: now(), status: 'running', notes: '',
      };
      this.data.sessions.push(s);
    }
    this.changed();
    return s;
  }

  /** Balance con el que sigue una sesión: el inicial más lo ganado en ella. */
  balanceOf(sessionId) {
    const s = this.session(sessionId);
    if (!s) return null;
    return s.startBalance + this.data.trades.filter((t) => t.sessionId === sessionId).reduce((a, t) => a + t.pnl, 0);
  }

  endSession(sessionId, { endBalance = null, replayTo = null } = {}) {
    const s = this.session(sessionId);
    if (!s) return;
    s.status = 'done';
    s.endBalance = endBalance ?? this.balanceOf(sessionId);
    if (replayTo != null) s.replayTo = Math.max(s.replayTo ?? replayTo, replayTo);
    s.updatedAt = now();
    this.changed();
  }

  renameSession(id, name) {
    const s = this.session(id);
    if (s && str(name, 120)) { s.name = str(name, 120); this.changed(); }
  }

  deleteSession(id) {
    this.data.sessions = this.data.sessions.filter((s) => s.id !== id);
    this.data.trades = this.data.trades.filter((t) => t.sessionId !== id);
    if (this.data.continueSessionId === id) this.data.continueSessionId = null;
    this.changed();
  }

  // --- operaciones -----------------------------------------------------------
  /** Guarda una operación cerrada (de paper.js) en una sesión. */
  addTrade(sessionId, t) {
    const s = this.session(sessionId);
    if (!s) return null;
    const { risk, r } = riskOf(t);
    const trade = cleanTrade({
      ...t, id: uid('t'), type: s.type, sessionId: s.id, userId: s.userId, strategyId: s.strategyId, risk, r, createdAt: now(),
    });
    this.data.trades.push(trade);
    if (this.data.trades.length > MAX_TRADES) this.data.trades.splice(0, this.data.trades.length - MAX_TRADES);
    s.endBalance = this.balanceOf(s.id);
    if (trade.exitTime != null) s.replayTo = Math.max(s.replayTo ?? trade.exitTime, trade.exitTime);
    s.updatedAt = now();
    this.changed();
    return trade;
  }

  /** Notas, etiquetas, setup y emoción de una operación (el journal). */
  updateTrade(id, patch) {
    const t = this.data.trades.find((x) => x.id === id);
    if (!t) return;
    if (patch.notes != null) t.notes = str(patch.notes, 4000);
    if (patch.setup != null) t.setup = str(patch.setup, 80);
    if (patch.emotion != null) t.emotion = str(patch.emotion, 40);
    if (patch.tags != null) t.tags = (Array.isArray(patch.tags) ? patch.tags : String(patch.tags).split(','))
      .map((x) => str(x, 40)).filter(Boolean).slice(0, 20);
    this.changed();
  }

  deleteTrade(id) {
    const t = this.data.trades.find((x) => x.id === id);
    if (!t) return;
    this.data.trades = this.data.trades.filter((x) => x.id !== id);
    const s = this.session(t.sessionId);
    if (s) s.endBalance = this.balanceOf(s.id);
    this.changed();
  }

  /**
   * Operaciones filtradas: { userId, strategyId, sessionId, symbol, side, outcome ('win'|'loss'|'be'),
   * from, to (segundos UTC de cierre), tag, breakeven (umbral $) }. Ordenadas por cierre.
   */
  query(f = {}) {
    const userId = f.userId ?? this.data.activeUserId;
    const be = Math.max(0, Number(f.breakeven) || 0);
    return this.data.trades.filter((t) => t.userId === userId
      && (!f.strategyId || t.strategyId === f.strategyId)
      && (!f.sessionId || t.sessionId === f.sessionId)
      && (!f.symbol || t.symbol === f.symbol)
      && (!f.side || t.side === f.side)
      && (!f.tag || t.tags.includes(f.tag))
      && (f.from == null || (t.exitTime ?? 0) >= f.from)
      && (f.to == null || (t.exitTime ?? 0) <= f.to)
      && (!f.outcome || (f.outcome === 'win' ? t.pnl > be : f.outcome === 'loss' ? t.pnl < -be : Math.abs(t.pnl) <= be)))
      .sort((a, b) => (a.exitTime ?? 0) - (b.exitTime ?? 0));
  }

  /** Balance inicial para unas estadísticas: el de la sesión, o el de la primera sesión incluida. */
  startBalanceFor(f = {}) {
    if (f.sessionId) return this.session(f.sessionId)?.startBalance ?? 100000;
    const ss = this.sessionsOf({ userId: f.userId, strategyId: f.strategyId });
    return ss.length ? ss[ss.length - 1].startBalance : 100000;
  }

  // --- exportar / importar ---------------------------------------------------
  exportJSON() { return JSON.stringify({ app: 'albertoscharts-journal', ...this.data }, null, 2); }

  /** Importa un journal exportado: añade lo que no esté (por id), sin borrar nada. */
  importJSON(text) {
    const incoming = migrate(JSON.parse(text));
    const merge = (key) => {
      const have = new Set(this.data[key].map((x) => x.id));
      let n = 0;
      for (const x of incoming[key]) if (!have.has(x.id)) { this.data[key].push(x); n++; }
      return n;
    };
    const res = { users: merge('users'), strategies: merge('strategies'), sessions: merge('sessions'), trades: merge('trades') };
    this.data = migrate(this.data);
    this.changed();
    return res;
  }

  /** CSV de operaciones (para Excel / Google Sheets). */
  tradesCSV(trades) {
    const strat = new Map(this.data.strategies.map((s) => [s.id, s.name]));
    const ses = new Map(this.data.sessions.map((s) => [s.id, s.name]));
    const iso = (t) => (t == null ? '' : new Date(t * 1000).toISOString().replace('.000Z', 'Z'));
    const q = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const head = ['strategy', 'session', 'symbol', 'side', 'qty', 'entry', 'exit', 'sl', 'tp', 'pnl', 'pnl_pct', 'r', 'entry_time_utc', 'exit_time_utc', 'reason', 'tags', 'setup', 'notes'];
    const rows = trades.map((t) => [strat.get(t.strategyId), ses.get(t.sessionId), t.symbol, t.side, t.qty, t.entry, t.exit, t.sl, t.tp,
      t.pnl, t.pnlPct?.toFixed(4), t.r?.toFixed(3), iso(t.entryTime), iso(t.exitTime), t.reason, t.tags.join('|'), t.setup, t.notes].map(q).join(','));
    return [head.join(','), ...rows].join('\n');
  }
}
