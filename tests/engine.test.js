const test = require('node:test'), assert = require('node:assert');
const E = require('../games/texas-holdem/engine');
const mk = (n, stack = 100) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, stack }));
const turn = s => s.players[s.toAct].id;

test('hand rankings', () => {
  const r = c => E.best7(c.split(' '));
  assert.equal(r('Ah Kh Qh Jh Th 2c 3d').name, 'Royal flush');
  assert.equal(r('9h 8h 7h 6h 5h 2c 3d').name, 'Straight flush');
  assert.equal(r('Ah 2d 3c 4s 5h 9c 9d').name, 'Straight');
  assert.equal(r('As Ad Ac Kd Kc 2c 3d').name, 'Full house');
  assert.ok(E.cmp(r('As Ad 5c 6d 8c 2c 3d').score, r('Ks Kd 5c 6d 8c 2c 3d').score) > 0);
});
test('ante of exactly 1, no blinds; 1-credit player is auto all-in', () => {
  const s = E.startHand([{ id: 'a', name: 'a', stack: 1 }, { id: 'b', name: 'b', stack: 50 }, { id: 'c', name: 'c', stack: 50 }]);
  assert.equal(E.pot(s), 3); assert.equal(s.players[0].allIn, true); assert.equal(s.players[1].stack, 49);
});
test('all-check cycle skips the 2nd cycle; a called bet triggers it', () => {
  const s = E.startHand(mk(3)); const seen = new Set();
  while (s.phase === 'betting') { seen.add(s.street + '-' + s.cycle); E.act(s, turn(s), { type: 'check' }); }
  assert.equal(seen.size, 4); assert.ok([...seen].every(k => k.endsWith('-1')));
  assert.equal(s.board.length, 5); assert.equal(s.players.reduce((t, p) => t + p.stack, 0), 300);
  const g = E.startHand(mk(3)); E.act(g, turn(g), { type: 'raise', to: 5 }); E.act(g, turn(g), { type: 'call' }); E.act(g, turn(g), { type: 'call' });
  assert.equal(g.street, 1); assert.equal(g.cycle, 1); // pre-flop is a single round, even after a bet
  const f = E.startHand(mk(3)); while (f.street === 0) E.act(f, turn(f), { type: 'check' });
  E.act(f, turn(f), { type: 'raise', to: 2 }); E.act(f, turn(f), { type: 'call' }); E.act(f, turn(f), { type: 'call' });
  assert.equal(f.street, 1); assert.equal(f.cycle, 2); assert.equal(f.currentBet, 0); // flop: round 2 opens after the bet was called
});
test('check illegal facing a bet; raise reopens action; min-raise enforced', () => {
  const s = E.startHand(mk(3));
  const a = turn(s); E.act(s, a, { type: 'raise', to: 10 });
  const b = turn(s); assert.throws(() => E.act(s, b, { type: 'check' }));
  E.act(s, b, { type: 'call' }); const c = turn(s); E.act(s, c, { type: 'raise', to: 30 });
  assert.equal(turn(s), a);
  assert.throws(() => E.act(s, a, { type: 'raise', to: 31 }));
  assert.throws(() => E.act(s, b, { type: 'call' })); // out of turn
});
test('fold to one player ends hand immediately', () => {
  const s = E.startHand(mk(3)); E.act(s, turn(s), { type: 'fold' }); E.act(s, turn(s), { type: 'fold' });
  assert.equal(s.phase, 'done'); assert.equal(s.result.uncontested, true);
});
test('side pots; all-in fuzz conserves credits', () => {
  const mkp = (t, f = false) => ({ id: 'x' + t, total: t, folded: f });
  const pots = E.buildPots([mkp(20), mkp(60), mkp(100)]);
  assert.deepEqual(pots.map(p => p.amount), [60, 80, 40]); assert.deepEqual(pots[2].eligible, ['x100']);
  const ps = [{ id: 'a', name: 'a', stack: 20 }, { id: 'b', name: 'b', stack: 60 }, { id: 'c', name: 'c', stack: 100 }];
  for (let i = 0; i < 100; i++) {
    const s = E.startHand(ps, i); let g = 0;
    while (s.phase === 'betting' && g++ < 200) { const L = E.legalActions(s, turn(s)); E.act(s, turn(s), { type: Math.random() < .7 ? (L.actions.includes('allin') ? 'allin' : 'call') : L.actions[0] === 'fold' && Math.random() < .3 ? 'fold' : (L.actions.includes('check') ? 'check' : 'call') }); }
    assert.equal(s.phase, 'done'); assert.equal(s.players.reduce((t, p) => t + p.stack, 0), 180);
  }
});
test('tie split with deterministic odd chip', () => {
  const s = E.startHand(mk(3), 0);
  s.board = ['Ah', 'Kh', 'Qh', 'Jh', 'Th']; // royal on board: everyone ties
  s.players.forEach((p, i) => { p.hole = ['2c', '3d']; p.stack = 0; p.total = [1, 2, 2][i]; p.folded = i === 0; });
  E.showdown(s);
  assert.equal(s.result.payouts.p1, 3); assert.equal(s.result.payouts.p2, 2); // odd chip: first winner left of button
});

test('kicking a player mid-hand folds them and play continues', () => {
  const s = E.startHand(mk(3)); const first = turn(s);
  E.forceFold(s, first); assert.notEqual(turn(s), first); assert.equal(s.players.find(p => p.id === first).folded, true);
  const other = s.players.find(p => !p.folded && p.id !== turn(s)).id; E.forceFold(s, other);
  assert.equal(s.phase, 'done'); assert.equal(s.result.uncontested, true);
  assert.equal(s.players.reduce((t, p) => t + p.stack, 0), 300);
});

const toFlop = s => { while (s.street === 0) E.act(s, turn(s), { type: 'check' }); return s; };
const betAndCall = (s, to) => { const st = s.street; E.act(s, turn(s), { type: 'raise', to }); while (s.street === st && s.cycle === 1) E.act(s, turn(s), { type: 'call' }); };
test('round 2: minimum bet is double (up to 10) and may be higher', () => {
  for (const [x, v] of [[1, 2], [3, 6], [5, 10]]) {
    const s = toFlop(E.startHand(mk(3))); betAndCall(s, x); assert.equal(s.cycle, 2);
    const L = E.legalActions(s, turn(s)); assert.equal(L.minTo, v); assert.ok(L.maxTo > v); assert.ok(L.actions.includes('check'));
    assert.throws(() => E.act(s, turn(s), { type: 'raise', to: v - 1 }));
    E.act(s, turn(s), { type: 'raise', to: v + 1 }); assert.equal(s.currentBet, v + 1);
  }
});
test('round 2: above the cap the bet only has to be higher', () => {
  for (const [x, v] of [[6, 7], [10, 11], [20, 21]]) {
    const s = toFlop(E.startHand(mk(3, 200))); betAndCall(s, x);
    const L = E.legalActions(s, turn(s)); assert.equal(L.minTo, v); assert.ok(L.maxTo > v);
    assert.throws(() => E.act(s, turn(s), { type: 'raise', to: x }));
    E.act(s, turn(s), { type: 'raise', to: v + 3 });
  }
});
test('round 2: all-in always allowed; all-check round 2 moves on', () => {
  const s = toFlop(E.startHand(mk(3))); betAndCall(s, 1); E.act(s, turn(s), { type: 'allin' }); assert.ok(s.players.some(p => p.allIn));
  const t = toFlop(E.startHand(mk(3))); betAndCall(t, 1); for (let i = 0; i < 3; i++) E.act(t, turn(t), { type: 'check' });
  assert.equal(t.street, 2);
});
test('uncontested win reveals the winner hand name', () => {
  const s = E.startHand(mk(3)); E.act(s, turn(s), { type: 'fold' }); E.act(s, turn(s), { type: 'fold' });
  const w = Object.keys(s.result.payouts)[0]; assert.ok(s.result.hands[w].name); assert.ok(s.result.hands[w].cards.length >= 2);
});
test('variant deck and ace-low straight follow the lowest rank', () => {
  const d = E.newDeck(7); assert.equal(d.length, 32); assert.ok(d.every(c => '789TJQKA'.includes(c[0])));
  assert.equal(E.bestHand(['Ah', '7d', '8c', '9h', 'Td'], 7).name, 'High card'); // ace is never low in a short deck
  assert.equal(E.bestHand(['Ah', '7d', '8c', '9h', 'Td'], 2).name, 'High card');
  const s = E.startHand(mk(4), 0, { minRank: 5 }); assert.ok(s.deck.concat(...s.players.map(p => p.hole)).every(c => '56789TJQKA'.includes(c[0])));
});

test('straight detection is exact for every deck (ace-low only in the full deck)', () => {
  const R = '23456789TJQKA', S = 'cdhsc';
  const combos = (a, k) => { const o = []; (function r(s, c) { if (c.length === k) return o.push([...c]); for (let i = s; i < a.length; i++) { c.push(a[i]); r(i + 1, c); c.pop(); } })(0, []); return o; };
  for (const lo of [2, 3, 7, 10]) {
    const vals = []; for (let v = lo; v <= 14; v++) vals.push(v);
    for (const c of combos(vals, 5)) {
      const run = Math.max(...c) - Math.min(...c) === 4, wheel = lo === 2 && [14, 2, 3, 4, 5].every(x => c.includes(x));
      assert.equal(E.rank5(c.map((v, i) => R[v - 2] + S[i]), lo)[0] === 4, run || wheel, `lo=${lo} ranks=${c}`);
    }
  }
});
test('10-A deck works for 6 players', () => {
  assert.equal(E.newDeck(10).length, 20);
  const s = E.startHand(mk(6), 0, { minRank: 10 }); while (s.phase === 'betting') E.act(s, turn(s), { type: 'check' });
  assert.equal(s.phase, 'done'); assert.equal(s.players.reduce((t, p) => t + p.stack, 0), 600);
});
test('host can overturn the showdown result; credits stay conserved', () => {
  const s = E.startHand(mk(3), 0); s.board = ['Ah', 'Kh', 'Qh', 'Jh', 'Th'];
  s.players.forEach((p, i) => { p.hole = ['2c', '3d']; p.stack = 0; p.total = [1, 2, 2][i]; p.folded = i === 0; });
  E.showdown(s); assert.equal(s.result.payouts.p1, 3);
  assert.throws(() => E.overrideResult(s, [{ winners: ['p0'] }, ...[]].slice(0, 1)), /Winners must be/); // folded player is not eligible
  E.overrideResult(s, [{ winners: ['p2'] }, { winners: ['p2'] }].slice(0, s.result.pots.length));
  assert.equal(s.players.find(p => p.id === 'p2').stack, 5); assert.equal(s.players.find(p => p.id === 'p1').stack, 0);
  assert.equal(s.players.reduce((t, p) => t + p.stack, 0), 5); assert.equal(s.result.overridden, true);
});
