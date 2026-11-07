// Pure, server-authoritative Texas Hold'em engine: 1-credit ante, no blinds, two betting cycles per street.
const crypto = require('crypto');
const RANKS = '23456789TJQKA', SUITS = 'cdhs';
const HAND_NAMES = ['High card','Pair','Two pair','Three of a kind','Straight','Flush','Full house','Four of a kind','Straight flush'];
const STREETS = ['Pre-flop','Flop','Turn','River'];

const newDeck = (lo = 2) => { const d = []; for (const r of RANKS) if (RANKS.indexOf(r) + 2 >= lo) for (const s of SUITS) d.push(r + s); return d; };
function shuffle(d, rand = n => crypto.randomInt(n)) { // CSPRNG Fisher-Yates
  const a = [...d];
  for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function rank5(cs, lo = 2) {
  const v = cs.map(c => RANKS.indexOf(c[0]) + 2).sort((a, b) => b - a);
  const flush = cs.every(c => c[1] === cs[0][1]);
  const u = [...new Set(v)];
  let hi = 0;
  if (u.length === 5) { if (u[0] - u[4] === 4) hi = u[0]; else if (u[0] === 14 && u[4] === lo && u[1] === lo + 3) hi = lo + 3; }
  const cnt = {}; v.forEach(x => cnt[x] = (cnt[x] || 0) + 1);
  const g = Object.entries(cnt).map(([k, c]) => [c, +k]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const gs = g.map(x => x[1]);
  if (hi && flush) return [8, hi];
  if (g[0][0] === 4) return [7, ...gs];
  if (g[0][0] === 3 && g[1][0] === 2) return [6, ...gs];
  if (flush) return [5, ...v];
  if (hi) return [4, hi];
  if (g[0][0] === 3) return [3, ...gs];
  if (g[0][0] === 2 && g[1][0] === 2) return [2, ...gs];
  if (g[0][0] === 2) return [1, ...gs];
  return [0, ...v];
}
const cmp = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; };
function combos(a, k) {
  const out = [];
  (function rec(st, cur) { if (cur.length === k) return out.push([...cur]); for (let i = st; i < a.length; i++) { cur.push(a[i]); rec(i + 1, cur); cur.pop(); } })(0, []);
  return out;
}
// Best 5-card hand from any number of cards (2 cards = pre-flop: pair or high card). lo = lowest rank in the deck (ace-low straight uses it).
function bestHand(cards, lo = 2) {
  if (cards.length < 5) {
    const v = cards.map(c => RANKS.indexOf(c[0]) + 2).sort((a, b) => b - a), pair = v.length === 2 && v[0] === v[1];
    return { score: [pair ? 1 : 0, ...v], cards: [...cards], name: pair ? 'Pair' : 'High card' };
  }
  let best = null;
  for (const five of combos(cards, 5)) { const r = rank5(five, lo); if (!best || cmp(r, best.score) > 0) best = { score: r, cards: five }; }
  best.name = best.score[0] === 8 && best.score[1] === 14 ? 'Royal flush' : HAND_NAMES[best.score[0]];
  return best;
}
const best7 = bestHand;

const pot = s => s.players.reduce((t, p) => t + p.total, 0);

// Side pots from total hand contributions (folded chips stay in the pot, folded players can't win).
function buildPots(players) {
  const levels = [...new Set(players.filter(p => !p.folded && p.total > 0).map(p => p.total))].sort((a, b) => a - b);
  const pots = []; let prev = 0;
  levels.forEach((lv, i) => {
    let amount = 0;
    for (const p of players) amount += Math.max(0, Math.min(p.total, lv) - prev);
    if (i === levels.length - 1) for (const p of players) amount += Math.max(0, p.total - lv);
    pots.push({ amount, eligible: players.filter(p => !p.folded && p.total >= lv).map(p => p.id) });
    prev = lv;
  });
  return pots;
}

function startHand(ps, button = 0, opts = {}) {
  const lo = opts.minRank || 2, deck = opts.deck || shuffle(newDeck(lo));
  const players = ps.map(p => ({ id: p.id, name: p.name, stack: p.stack, folded: false, allIn: false, total: 0, cycle: 0, acted: false, hole: [] }));
  const s = { players, button: button % players.length, street: 0, cycle: 1, currentBet: 0, lastRaise: 1, deck: [...deck], minRank: lo, r2: null, board: [], phase: 'betting', toAct: -1, seq: 0, result: null };
  players.forEach(p => { const a = Math.min(1, p.stack); p.stack -= a; p.total += a; if (!p.stack) p.allIn = true; }); // initial contribution
  for (let i = 0; i < 2; i++) players.forEach(p => p.hole.push(s.deck.pop()));
  startCycle(s);
  return s;
}

const needsAction = (s, p) => !p.folded && !p.allIn && (!p.acted || p.cycle < s.currentBet);
function nextActor(s, from) {
  const n = s.players.length;
  for (let i = 1; i <= n; i++) { const idx = (from + i) % n; if (needsAction(s, s.players[idx])) return idx; }
  return -1;
}
function startCycle(s) {
  s.players.forEach(p => { p.cycle = 0; p.acted = false; });
  s.currentBet = 0; s.lastRaise = 1;
  if (s.players.filter(p => !p.folded && !p.allIn).length < 2) { s.toAct = -1; return endCycle(s); }
  s.toAct = nextActor(s, s.button);
}
function endCycle(s) {
  // Pre-flop has ONE round. Later streets get a 2nd round only if round 1 had a bet that was called; all-check moves on.
  if (s.cycle === 1 && s.street > 0 && s.currentBet > 0) {
    const x = s.currentBet; // round-2 bet: double the round-1 bet while the double is <= 10, otherwise just more than round 1
    s.r2 = 2 * x <= 10 ? { min: 2 * x, exact: true } : { min: x + 1, exact: false };
    s.cycle = 2; return startCycle(s);
  }
  if (s.street === 3) return showdown(s);
  s.street++; s.cycle = 1; s.r2 = null;
  const n = s.street === 1 ? 3 : 1;
  for (let i = 0; i < n; i++) s.board.push(s.deck.pop());
  startCycle(s);
}

function legalActions(s, id) {
  if (s.phase !== 'betting' || s.toAct < 0 || s.players[s.toAct].id !== id) return null;
  const p = s.players[s.toAct];
  const owe = s.currentBet - p.cycle, max = p.cycle + p.stack;
  const actions = ['fold', owe === 0 ? 'check' : 'call'];
  let minTo = null, maxTo = null;
  const r2open = s.cycle === 2 && s.currentBet === 0 && s.r2;
  if (max > s.currentBet) {
    actions.push('allin'); // all-in is always allowed
    if (r2open) { if (max >= s.r2.min) { actions.push('raise'); minTo = s.r2.min; maxTo = s.r2.exact ? s.r2.min : max; } }
    else { actions.push('raise'); minTo = Math.min(max, s.currentBet + s.lastRaise); maxTo = max; }
  } else if (owe > 0) actions.push('allin');
  return { actions, toCall: Math.min(owe, p.stack), minTo, maxTo };
}

function put(p, amt) { p.stack -= amt; p.cycle += amt; p.total += amt; if (!p.stack) p.allIn = true; }

function act(s, id, action) {
  const L = legalActions(s, id);
  if (!L) throw new Error('Not your turn');
  const p = s.players[s.toAct];
  let type = action.type; const wantAll = type === 'allin';
  if (wantAll) {
    if (!L.actions.includes('allin')) throw new Error('Illegal action: allin');
    if (p.cycle + p.stack > s.currentBet) { type = 'raise'; action = { to: p.cycle + p.stack }; } else type = 'call';
  } else if (!L.actions.includes(type)) throw new Error('Illegal action: ' + type);
  if (type === 'fold') p.folded = true;
  else if (type === 'check') p.acted = true;
  else if (type === 'call') { put(p, L.toCall); p.acted = true; }
  else if (type === 'raise') {
    const to = Math.floor(Number(action.to));
    if (!wantAll && !(to >= L.minTo && to <= L.maxTo)) throw new Error(L.minTo === L.maxTo ? `Bet must be exactly ${L.minTo}` : `Raise to must be between ${L.minTo} and ${L.maxTo}`);
    if (to - s.currentBet >= s.lastRaise) s.lastRaise = to - s.currentBet;
    put(p, to - p.cycle); s.currentBet = to; p.acted = true;
  }
  s.seq++;
  const alive = s.players.filter(x => !x.folded);
  if (alive.length === 1) return award(s, alive[0]);
  const nxt = nextActor(s, s.toAct);
  if (nxt < 0) endCycle(s); else s.toAct = nxt;
  return s;
}

// Host kick mid-hand: the player folds (their chips stay in the pot) and play moves on.
function forceFold(s, id) {
  if (s.phase !== 'betting') return s;
  const idx = s.players.findIndex(p => p.id === id), p = s.players[idx];
  if (!p || p.folded) return s;
  const wasTurn = s.toAct === idx; p.folded = true; s.seq++;
  const alive = s.players.filter(x => !x.folded);
  if (alive.length === 1) return award(s, alive[0]);
  if (wasTurn) { const nxt = nextActor(s, idx); if (nxt < 0) endCycle(s); else s.toAct = nxt; }
  return s;
}

function award(s, winner) { // uncontested pot: no showdown needed
  const amount = pot(s);
  winner.stack += amount;
  s.phase = 'done'; s.toAct = -1;
  const hand = bestHand([...winner.hole, ...s.board], s.minRank); // winner's cards + hand name are shown to everyone
  s.result = { uncontested: true, pots: [{ amount, winners: [winner.id], eligible: [winner.id] }], payouts: { [winner.id]: amount }, hands: { [winner.id]: { name: hand.name, cards: hand.cards } } };
}

function showdown(s) {
  const hands = {};
  s.players.filter(p => !p.folded).forEach(p => hands[p.id] = best7([...p.hole, ...s.board], s.minRank));
  const payouts = {}, potsOut = [];
  for (const pt of buildPots(s.players)) {
    let top = null, winners = [];
    for (const id of pt.eligible) {
      const c = top ? cmp(hands[id].score, hands[top].score) : 1;
      if (c > 0) { top = id; winners = [id]; } else if (c === 0) winners.push(id);
    }
    // Odd-chip rule: leftover credits go one at a time to winners in seat order starting left of the button.
    const order = [];
    for (let i = 1; i <= s.players.length; i++) { const q = s.players[(s.button + i) % s.players.length]; if (winners.includes(q.id)) order.push(q.id); }
    const share = Math.floor(pt.amount / order.length); let odd = pt.amount - share * order.length;
    order.forEach(id => { payouts[id] = (payouts[id] || 0) + share + (odd-- > 0 ? 1 : 0); });
    potsOut.push({ amount: pt.amount, winners: order, eligible: pt.eligible });
  }
  s.players.forEach(p => { if (payouts[p.id]) p.stack += payouts[p.id]; });
  s.phase = 'done'; s.toAct = -1;
  s.result = { uncontested: false, pots: potsOut, payouts, hands: Object.fromEntries(Object.entries(hands).map(([id, h]) => [id, { name: h.name, cards: h.cards }])) };
}

module.exports = { newDeck, shuffle, rank5, best7, bestHand, cmp, buildPots, startHand, legalActions, act, forceFold, showdown, pot, STREETS };
