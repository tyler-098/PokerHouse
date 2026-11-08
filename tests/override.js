const { server } = require('../server'); const { io } = require('socket.io-client');
server.listen(0, async () => {
  const url = 'http://localhost:' + server.address().port;
  const mk = () => new Promise(r => { const s = io(url); s.on('state', x => s.st = x); s.on('connect', () => r(s)); });
  const emit = (s, e, d) => new Promise(r => s.emit(e, d, r)); const wait = ms => new Promise(r => setTimeout(r, ms));
  const [a, b] = await Promise.all([mk(), mk()]);
  const ra = await emit(a, 'create_room', { nickname: 'A', stack: 100 }); await emit(b, 'join_room', { nickname: 'B', stack: 100, code: ra.code });
  console.log('10-A variant accepted', (await emit(a, 'set_variant', { minRank: 10 })).ok, '| 11 rejected', !(await emit(a, 'set_variant', { minRank: 11 })).ok);
  await emit(a, 'set_variant', { minRank: 2 }); await emit(a, 'start_game', {}); await wait(60);
  let n = 0; while (a.st.status === 'playing' && n++ < 60) { const t = [a, b].find(s => s.st.hand.toAct === s.st.me); await emit(t, 'action', { type: t.st.hand.legal.actions.includes('check') ? 'check' : 'call' }); await wait(5); }
  const R = a.st.hand.result, pot = R.pots[0], target = pot.eligible.find(id => !pot.winners.includes(id)) || pot.eligible[0];
  console.log('non-host cannot fix', !(await emit(b, 'override_result', { pots: [{ winners: [target] }] })).ok);
  console.log('bad winner rejected', !(await emit(a, 'override_result', { pots: [{ winners: ['nobody'] }] })).ok);
  console.log('host fixes result', (await emit(a, 'override_result', { pots: [{ winners: [target] }] })).ok); await wait(40);
  const R2 = b.st.hand.result, st = Object.fromEntries(b.st.players.map(p => [p.id, p.stack]));
  console.log('winner is now the chosen player', R2.pots[0].winners.join() === target, '| overridden flag', R2.overridden === true);
  console.log('target holds the whole pot', st[target] === 100 - pot.amount / 2 + pot.amount, '| credits conserved', Object.values(st).reduce((x, y) => x + y, 0) === 200);
  await emit(a, 'start_game', {}); await wait(50);
  console.log('cannot fix after next hand starts', !(await emit(a, 'override_result', { pots: [{ winners: [target] }] })).ok);
  process.exit(0);
});
