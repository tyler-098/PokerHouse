// Game catalogue: register a module here to make it available to rooms.
const games = new Map();
const register = m => games.set(m.metadata.id, { module: m, enabled: true });
register(require('../games/texas-holdem'));
module.exports = {
  register,
  get: id => { const g = games.get(id); return g && g.enabled ? g.module : null; },
  list: () => [...games.values()].filter(g => g.enabled).map(g => g.module.metadata),
  setEnabled: (id, v) => { if (games.has(id)) games.get(id).enabled = v; },
};
