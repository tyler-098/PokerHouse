const { server } = require('../server'); const { io } = require('socket.io-client');
server.listen(0, async () => {
  const url = 'http://localhost:' + server.address().port;
  const mk = () => new Promise(r => { const s = io(url); s.on('state', x => s.st = x); s.on('connect', () => r(s)); });
  const emit = (s, e, d) => new Promise(r => s.emit(e, d, r)); const wait = ms => new Promise(r => setTimeout(r, ms));
  const [a, b] = await Promise.all([mk(), mk()]);
  const ra = await emit(a, 'create_room', { nickname: 'A', stack: 100 }); await emit(b, 'join_room', { nickname: 'B', stack: 100, code: ra.code });
  await emit(a, 'start_game', {}); await wait(80);
  let n = 0; while (a.st.status === 'playing' && n++ < 60) { const t = [a, b].find(s => s.st.hand.toAct === s.st.me); await emit(t, 'action', { type: t.st.hand.legal.actions.includes('check') ? 'check' : 'call' }); await wait(5); }
  const h1 = a.st.handNo; console.log('hand finished, status', a.st.status); await wait(11000);
  console.log('no auto-deal after 11s:', a.st.status === 'between' && a.st.handNo === h1);
  console.log('non-host cannot deal:', !(await emit(b, 'start_game', {})).ok);
  console.log('host deals next hand:', (await emit(a, 'start_game', {})).ok, a.st.handNo === h1 + 1 || (await wait(50), a.st.handNo === h1 + 1));
  process.exit(0);
});
