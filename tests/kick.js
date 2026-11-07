const { server } = require('../server'); const { io } = require('socket.io-client');
server.listen(0, async () => {
  const url = 'http://localhost:' + server.address().port;
  const mk = () => new Promise(r => { const s = io(url); s.st = null; s.on('state', x => s.st = x); s.on('kicked', () => s.kicked = true); s.on('connect', () => r(s)); });
  const emit = (s, e, d) => new Promise(r => s.emit(e, d, r)); const wait = ms => new Promise(r => setTimeout(r, ms));
  const [a, b, c] = await Promise.all([mk(), mk(), mk()]);
  const ra = await emit(a, 'create_room', { nickname: 'A', stack: 100 });
  await emit(b, 'join_room', { nickname: 'B', stack: 100, code: ra.code }); await emit(c, 'join_room', { nickname: 'C', stack: 100, code: ra.code });
  await emit(a, 'start_game', {}); await wait(100);
  console.log('non-host kick blocked', !(await emit(b, 'kick', { playerId: c.st.me })).ok);
  console.log('host cannot kick self', !(await emit(a, 'kick', { playerId: a.st.me })).ok);
  const turner = [a, b, c].find(s => s.st.hand.toAct === s.st.me);
  const victim = turner === a ? b : turner; // kick whoever is to act (never the host)
  console.log('kick ok', (await emit(a, 'kick', { playerId: victim.st.me })).ok); await wait(100);
  console.log('victim told', !!victim.kicked, '| players left', a.st.players.length, '| victim folded in hand', a.st.hand.players.find(p => p.id === victim.st.me).folded);
  console.log('action not stuck on victim', a.st.hand.phase === 'done' || a.st.hand.toAct !== victim.st.me);
  console.log('victim cannot act', !(await emit(victim, 'action', { type: 'fold' })).ok);
  console.log('rejoin blocked', !(await emit(await mk(), 'join_room', { nickname: victim === b ? 'B' : 'C', stack: 100, code: ra.code })).ok);
  process.exit(0);
});
