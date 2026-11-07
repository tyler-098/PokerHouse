const { server } = require('../server'); const { io } = require('socket.io-client');
server.listen(0, async () => {
  const url = 'http://localhost:' + server.address().port;
  const mk = () => new Promise(r => { const s = io(url); s.on('state', x => s.st = x); s.on('connect', () => r(s)); });
  const emit = (s, e, d) => new Promise(r => s.emit(e, d, r)); const wait = ms => new Promise(r => setTimeout(r, ms));
  const ss = await Promise.all([mk(), mk(), mk(), mk()]); const [a, b, c, d] = ss;
  const ra = await emit(a, 'create_room', { nickname: 'A', stack: 100 });
  for (const [s, n] of [[b, 'B'], [c, 'C'], [d, 'D']]) await emit(s, 'join_room', { nickname: n, stack: 100, code: ra.code });
  await wait(50); const av = a.st.players.map(p => p.avatar);
  console.log('unique avatars', new Set(av).size === 4, av.join(','));
  console.log('non-host variant blocked', !(await emit(b, 'set_variant', { minRank: 7 })).ok, '| bad rank blocked', !(await emit(a, 'set_variant', { minRank: 12 })).ok);
  console.log('host sets 7-A', (await emit(a, 'set_variant', { minRank: 7 })).ok); await wait(30);
  await emit(a, 'start_game', {}); await wait(80);
  const H = a.st.hand, mine = H.players.find(p => p.id === a.st.me).hole;
  console.log('deck 7-A in use', H.minRank === 7 && mine.every(x => '789TJQKA'.includes(x[0])));
  console.log('variant locked mid-hand', !(await emit(a, 'set_variant', { minRank: 3 })).ok);
  const first = ss.find(s => s.st.hand.toAct === s.st.me), fid = first.st.me;
  console.log('pre-flop shows single round label data', H.streetIndex === 0);
  console.log('non-folded cannot show', !(await emit(ss.find(s => s !== first), 'show_hand', {})).ok);
  await emit(first, 'action', { type: 'fold' }); await wait(30);
  const obs = ss.find(s => s !== first);
  console.log('folded hidden before show', obs.st.hand.players.find(p => p.id === fid).hole[0] === '??');
  console.log('folded can show', (await emit(first, 'show_hand', {})).ok); await wait(30);
  console.log('everyone sees shown cards', obs.st.hand.players.find(p => p.id === fid).hole[0] !== '??');
  let n = 0; while (a.st.status === 'playing' && n++ < 20) { const t = ss.find(s => s.st.hand.toAct === s.st.me); await emit(t, 'action', { type: 'fold' }); await wait(20); }
  const R = a.st.hand.result, w = Object.keys(R.payouts)[0];
  console.log('uncontested: winner shown with hand name:', !!R.hands[w].name, R.hands[w].name, '| cards visible to others', obs.st.hand.players.find(p => p.id === w).hole[0] !== '??' || obs.st.me === w);
  process.exit(0);
});
