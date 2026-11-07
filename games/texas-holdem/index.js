// GameModule wrapper: the platform core only talks to this contract.
const E = require('./engine');
module.exports = {
  metadata: { id: 'texas-holdem', name: "Texas Hold'em (custom)", version: '2.0.0', minPlayers: 2, maxPlayers: 6, supportsSpectators: false, variants: { minRank: { min: 2, max: 9 } } },
  validateConfig: c => { const m = Number((c && c.minRank) ?? 2); if (!Number.isInteger(m) || m < 2 || m > 9) throw new Error('Deck must start between 2 and 9'); return { minRank: m }; },
  createInitialState: ({ players, button, config }) => E.startHand(players, button, { minRank: (config || {}).minRank }),
  getLegalActions: (s, id) => E.legalActions(s, id),
  validateAction: (s, id, a) => { const L = E.legalActions(s, id); return { ok: !!L && L.actions.includes(a.type) }; },
  applyAction: (s, id, a) => E.act(s, id, a),
  removePlayer: (s, id) => E.forceFold(s, id),
  canShowHand: (s, id) => { const p = s.players.find(x => x.id === id); return !!p && p.folded; },
  // Public projection: hole cards stay hidden unless it is you, the player chose to show, or the hand's result reveals them.
  getPublicState: (s, viewerId, extra = {}) => {
    const shown = extra.shown || [];
    const open = id => id === viewerId || shown.includes(id) || (s.phase === 'done' && s.result && s.result.hands[id] !== undefined);
    return {
      street: E.STREETS[s.street], streetIndex: s.street, cycle: s.cycle, board: s.board, pot: E.pot(s), currentBet: s.currentBet,
      seq: s.seq, phase: s.phase, button: s.players[s.button].id, toAct: s.toAct >= 0 ? s.players[s.toAct].id : null,
      minRank: s.minRank, r2: s.cycle === 2 ? s.r2 : null,
      players: s.players.map(p => ({ id: p.id, name: p.name, stack: p.stack, folded: p.folded, allIn: p.allIn, cycle: p.cycle, total: p.total,
        shown: shown.includes(p.id), hole: open(p.id) ? p.hole : ['??', '??'] })),
      legal: E.legalActions(s, viewerId), result: s.result,
    };
  },
  getPrivateState: (s, id) => ({ hole: s.players.find(p => p.id === id)?.hole || [] }),
  isComplete: s => s.phase === 'done',
  calculateResult: s => s.result,
  serialize: s => JSON.parse(JSON.stringify(s)),
  restore: o => o,
};
