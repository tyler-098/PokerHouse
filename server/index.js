// Platform core: rooms, sessions, seats, credit ledger, chat, sockets. Game rules live only in game modules.
const path = require('path'), http = require('http'), crypto = require('crypto');
const express = require('express'), { Server } = require('socket.io');
const registry = require('./registry');

const app = express();
app.get('/health', (_, res) => res.json({ ok: true, rooms: rooms.size }));
app.get('/api/ice', (_, res) => { // STUN by default; add a TURN server via env for strict networks
  const s = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
  if (process.env.TURN_URL) s.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USER, credential: process.env.TURN_PASS });
  res.set('Access-Control-Allow-Origin', process.env.FRONTEND_ORIGIN || '*'); res.json(s);
});
app.get('/api/games', (_, res) => res.json(registry.list()));
app.use(express.static(path.join(__dirname, '../web')));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.FRONTEND_ORIGIN || true } });

const rooms = new Map();
const MAX_SEATS = 6, TURN_MS = 45000;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const rid = n => crypto.randomBytes(n).toString('hex');
const makeCode = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c; do { c = Array.from({ length: 6 }, () => A[crypto.randomInt(A.length)]).join(''); } while (rooms.has(c)); return c; };
const cleanName = n => String(n || '').trim().replace(/[<>]/g, '').slice(0, 16);
const AVATARS = 8, nextAvatar = r => { const used = new Set(r.players.map(p => p.avatar)); for (let i = 0; i < AVATARS; i++) if (!used.has(i)) return i; return 0; };
const okStack = n => Number.isInteger(n) && n >= 50 && n <= 500;

function ledger(room, playerId, delta, reason, key) {
  if (key && room.keys.has(key)) return false;            // idempotent
  if (key) room.keys.add(key);
  room.ledger.push({ t: Date.now(), playerId, delta, reason });
  return true;
}

function project(room, viewer) {
  const mod = registry.get(room.gameId) || room.mod;
  const hand = room.state ? mod.getPublicState(room.state, viewer.id, { shown: [...room.shown] }) : null;
  return {
    code: room.code, me: viewer.id, host: room.host, game: mod.metadata, status: room.status,
    players: room.players.map(p => ({ id: p.id, name: p.name, stack: p.stack, connected: p.connected, avatar: p.avatar, voice: !!p.voice, vmuted: !!p.vmuted })),
    hand, handNo: room.handNo, config: room.config, deadline: room.deadline, chat: room.chat.slice(-40), minToStart: mod.metadata.minPlayers,
  };
}
function broadcast(room) {
  for (const p of room.players) if (p.sock) io.to(p.sock).emit('state', project(room, p));
}

function canDeal(room) { return room.players.filter(p => p.stack >= 1).length >= room.mod.metadata.minPlayers; }
function dealHand(room) {
  clearTimeout(room.nextTimer);
  const ps = room.players.filter(p => p.stack >= 1);
  if (ps.length < room.mod.metadata.minPlayers) { room.status = 'lobby'; room.state = null; return broadcast(room); }
  room.button = (room.button + 1) % ps.length;
  room.state = room.mod.createInitialState({ players: ps.map(p => ({ id: p.id, name: p.name, stack: p.stack })), button: room.button, config: room.config }, {}); room.shown.clear();
  room.status = 'playing'; room.handNo++;
  afterChange(room);
}
function syncStacks(room) {
  for (const sp of room.state.players) { const p = room.players.find(x => x.id === sp.id); if (p) p.stack = sp.stack; }
}
function afterChange(room) {
  clearTimeout(room.turnTimer); room.deadline = null;
  if (room.mod.isComplete(room.state)) {
    syncStacks(room);
    const res = room.mod.calculateResult(room.state);
    room.history.push({ hand: room.handNo, pots: res.pots, payouts: res.payouts });
    for (const [id, amt] of Object.entries(res.payouts)) ledger(room, id, amt, 'hand ' + room.handNo + ' payout', `payout:${room.handNo}:${id}`);
    room.status = 'between';
    // no auto-deal: the host presses "Deal next hand"
  } else {
    const id = room.state.players[room.state.toAct].id;
    room.deadline = Date.now() + TURN_MS;
    room.turnTimer = setTimeout(() => { // timeout: check if free, otherwise fold
      const L = room.mod.getLegalActions(room.state, id); if (!L) return;
      try { room.mod.applyAction(room.state, id, { type: L.actions.includes('check') ? 'check' : 'fold' }); afterChange(room); } catch {}
    }, TURN_MS);
  }
  broadcast(room);
}

io.on('connection', socket => {
  let room = null, me = null, hitsBy = {};
  const limited = (max = 40) => { const n = Date.now(), b = (hitsBy[max] = (hitsBy[max] || []).filter(t => n - t < 5000)); b.push(n); return b.length > max; };
  const bind = (r, p) => { room = r; me = p; p.sock = socket.id; p.connected = true; socket.join(r.code); };
  const guard = (fn, max) => (data, cb = () => {}) => {
    try { if (room && !room.players.includes(me)) { room = null; me = null; } if (limited(max)) throw new Error('Slow down'); fn(data || {}, cb); } catch (e) { cb({ ok: false, error: e.message }); }
  };

  socket.on('create_room', guard((d, cb) => {
    const name = cleanName(d.nickname); if (!name) throw new Error('Nickname required');
    if (!okStack(d.stack)) throw new Error('Starting stack must be 50–500');
    const mod = registry.get(d.gameId || 'texas-holdem'); if (!mod) throw new Error('Game not available');
    const token = rid(24), p = { id: rid(6), name, tokenHash: sha(token), stack: d.stack, sock: null, connected: true, avatar: 0 };
    const r = { code: makeCode(), mod, gameId: mod.metadata.id, host: p.id, players: [p], state: null, status: 'lobby', button: -1, handNo: 0, chat: [], ledger: [], history: [], keys: new Set(), banned: new Set(), config: mod.validateConfig({}), shown: new Set(), deadline: null };
    ledger(r, p.id, d.stack, 'starting stack');
    rooms.set(r.code, r); bind(r, p); cb({ ok: true, token, code: r.code }); broadcast(r);
  }));
  socket.on('join_room', guard((d, cb) => {
    const r = rooms.get(String(d.code || '').toUpperCase().trim()); if (!r) throw new Error('Room not found');
    const name = cleanName(d.nickname); if (!name) throw new Error('Nickname required');
    if (!okStack(d.stack)) throw new Error('Starting stack must be 50–500');
    if (r.banned.has(name.toLowerCase())) throw new Error('You were removed from this room');
    if (r.players.length >= MAX_SEATS) throw new Error('Table is full (6 seats)');
    if (r.players.some(x => x.name.toLowerCase() === name.toLowerCase())) throw new Error('Nickname already taken');
    const token = rid(24), p = { id: rid(6), name, tokenHash: sha(token), stack: d.stack, sock: null, connected: true, avatar: nextAvatar(r) };
    r.players.push(p); ledger(r, p.id, d.stack, 'starting stack');
    bind(r, p); cb({ ok: true, token, code: r.code }); broadcast(r);
  }));
  socket.on('resume', guard((d, cb) => {
    const r = rooms.get(String(d.code || '').toUpperCase()); const h = sha(String(d.token || ''));
    const p = r && r.players.find(x => x.tokenHash === h); if (!p) throw new Error('Session expired');
    bind(r, p); cb({ ok: true, code: r.code }); broadcast(r);
  }));
  socket.on('start_game', guard((d, cb) => {
    if (!room || me.id !== room.host) throw new Error('Host only');
    if (room.status === 'playing') throw new Error('Hand in progress');
    if (!canDeal(room)) throw new Error('Need at least 2 players with credits');
    dealHand(room); cb({ ok: true });
  }));
  socket.on('action', guard((d, cb) => { // client sends intent only; server validates against current state
    if (!room || !room.state || room.status !== 'playing') throw new Error('No hand in progress');
    if (d.seq !== undefined && d.seq !== room.state.seq) throw new Error('Stale action');
    const type = String(d.type); if (!['fold', 'check', 'call', 'raise', 'allin'].includes(type)) throw new Error('Unknown action');
    room.mod.applyAction(room.state, me.id, { type, to: d.to }); afterChange(room); cb({ ok: true });
  }));
  socket.on('replenish', guard((d, cb) => {
    if (!room || me.id !== room.host) throw new Error('Host only');
    if (room.status === 'playing') throw new Error('Replenish between hands only');
    const p = room.players.find(x => x.id === d.playerId), amt = d.amount;
    if (!p) throw new Error('Unknown player'); if (!Number.isInteger(amt) || amt < 20 || amt > 500) throw new Error('Amount must be 20–500');
    if (!ledger(room, p.id, amt, 'host replenishment', d.requestId || rid(8))) return cb({ ok: true, duplicate: true });
    p.stack += amt; broadcast(room); cb({ ok: true });
  }));
  socket.on('kick', guard((d, cb) => {
    if (!room || me.id !== room.host) throw new Error('Host only');
    const t = room.players.find(x => x.id === d.playerId);
    if (!t) throw new Error('Unknown player'); if (t.id === me.id) throw new Error("You can't kick yourself");
    if (room.status === 'playing' && room.state && room.mod.removePlayer) room.mod.removePlayer(room.state, t.id); // fold them out of the hand
    ledger(room, t.id, 0, 'removed by host'); room.banned.add(t.name.toLowerCase());
    room.players = room.players.filter(x => x !== t);
    if (t.sock) { io.to(t.sock).emit('kicked'); const ks = io.sockets.sockets.get(t.sock); if (ks) ks.leave(room.code); }
    if (room.status === 'playing') afterChange(room); else broadcast(room);
    cb({ ok: true });
  }));
  socket.on('set_variant', guard((d, cb) => {
    if (!room || me.id !== room.host) throw new Error('Host only');
    if (room.status === 'playing') throw new Error('Change the variant between hands');
    room.config = room.mod.validateConfig(d); broadcast(room); cb({ ok: true });
  }));
  socket.on('show_hand', guard((d, cb) => { // a folded player may choose to reveal their cards
    if (!room || !room.state) throw new Error('No hand to show');
    if (!room.mod.canShowHand(room.state, me.id)) throw new Error('You can only show your cards after folding');
    room.shown.add(me.id); broadcast(room); cb({ ok: true });
  }));
  // ---- voice chat: audio is peer-to-peer (WebRTC); the server only relays the setup messages between players in the same room
  socket.on('voice_join', guard((d, cb) => {
    if (!room) throw new Error('Not in a room');
    const peers = room.players.filter(p => p.voice && p.id !== me.id && p.connected).map(p => p.id);
    me.voice = true; me.vmuted = false; broadcast(room); cb({ ok: true, peers });
  }));
  socket.on('voice_signal', guard((d, cb) => {
    if (!room || !me.voice) throw new Error('Join voice first');
    const t = room.players.find(p => p.id === d.to && p.voice && p.sock);
    if (!t) return cb({ ok: false, error: 'Peer unavailable' });
    if (JSON.stringify(d.data || {}).length > 20000) throw new Error('Signal too large');
    io.to(t.sock).emit('voice_signal', { from: me.id, data: d.data }); cb({ ok: true });
  }, 400));
  socket.on('voice_mute', guard((d, cb) => { if (!room || !me.voice) throw new Error('Join voice first'); me.vmuted = !!d.muted; broadcast(room); cb({ ok: true }); }));
  socket.on('voice_leave', guard((d, cb) => { if (!room) return; me.voice = false; me.vmuted = false; broadcast(room); cb({ ok: true }); }));
  socket.on('override_result', guard((d, cb) => { // host corrects the winner(s) of the last hand, before the next hand is dealt
    if (!room || me.id !== room.host) throw new Error('Host only');
    if (room.status !== 'between' || !room.state || !room.mod.isComplete(room.state)) throw new Error('Only the last hand can be fixed, before the next one is dealt');
    const old = { ...room.state.result.payouts };
    room.mod.overrideResult(room.state, d.pots);
    syncStacks(room);
    const now = room.state.result.payouts;
    for (const id of new Set([...Object.keys(old), ...Object.keys(now)])) ledger(room, id, (now[id] || 0) - (old[id] || 0), 'host corrected hand ' + room.handNo);
    room.history.push({ hand: room.handNo, corrected: true, pots: room.state.result.pots, payouts: now });
    broadcast(room); cb({ ok: true });
  }));
  socket.on('chat', guard((d, cb) => {
    if (!room) throw new Error('Not in a room'); const text = String(d.text || '').trim().slice(0, 200); if (!text) return;
    room.chat.push({ name: me.name, text, t: Date.now() }); broadcast(room); cb({ ok: true });
  }));
  socket.on('disconnect', () => { if (me && me.sock === socket.id) { me.connected = false; me.sock = null; me.voice = false; if (room) broadcast(room); } });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) server.listen(PORT, () => console.log('Card platform listening on :' + PORT));
module.exports = { server, rooms };
