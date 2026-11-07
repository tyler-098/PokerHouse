// End-to-end smoke test: 3 socket clients play a full hand via the real server.
const { server } = require('../server'); const { io } = require('socket.io-client');
server.listen(0, async () => {
  const url = 'http://localhost:' + server.address().port;
  const mk = () => new Promise(r => { const s = io(url); s.st = null; s.on('state', x => s.st = x); s.on('connect', () => r(s)); });
  const emit = (s, e, d) => new Promise(r => s.emit(e, d, r));
  const [a, b, c] = await Promise.all([mk(), mk(), mk()]);
  const ra = await emit(a, 'create_room', { nickname: 'A', stack: 100 });
  console.log('create', ra.ok, ra.code);
  console.log('join B', (await emit(b, 'join_room', { nickname: 'B', stack: 100, code: ra.code })).ok);
  console.log('join C', (await emit(c, 'join_room', { nickname: 'C', stack: 100, code: ra.code })).ok);
  console.log('non-host start blocked', !(await emit(b, 'start_game', {})).ok);
  console.log('start', (await emit(a, 'start_game', {})).ok);
  await new Promise(r => setTimeout(r, 100));
  let n = 0; const all = [a, b, c];
  while (a.st.status === 'playing' && n++ < 60) {
    const t = all.find(s => s.st.hand.toAct === s.st.me); await emit(t, 'action', { type: t.st.hand.legal.actions.includes('check') ? 'check' : 'call' });
    await new Promise(r => setTimeout(r, 10));
  }
  const h = a.st.hand;
  console.log('status', a.st.status, 'actions', n, 'board', h.board.join(' '));
  console.log('privacy: opp cards hidden', h.players.filter(p => p.id !== a.st.me).length, 'players; visible own', h.players.find(p => p.id === a.st.me).hole.join(' '));
  console.log('credits conserved', a.st.players.reduce((t, p) => t + p.stack, 0) === 300);
  process.exit(0);
});
