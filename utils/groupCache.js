const TTL = 5 * 60 * 1000;

const cache = new Map();
const inflight = new Map();
let fetchFresh = null;

function getFresh(jid) {
  const e = cache.get(jid);
  if (e && Date.now() - e.ts < TTL) return e.data;
  if (e) cache.delete(jid);
  return undefined;
}

function invalidate(jid) {
  if (jid) cache.delete(jid);
}

async function fetchMetadata(jid) {
  const cached = getFresh(jid);
  if (cached) return cached;
  if (inflight.has(jid)) return inflight.get(jid);
  if (!fetchFresh) throw new Error('groupCache sin socket');

  const p = fetchFresh(jid)
    .then(data => {
      if (data?.participants) cache.set(jid, { data, ts: Date.now() });
      return data;
    })
    .finally(() => inflight.delete(jid));
  inflight.set(jid, p);
  return p;
}

async function cachedGroupMetadata(jid) {
  try { return await fetchMetadata(jid); } catch { return undefined; }
}

function installGroupCache(sock) {
  if (!sock || sock.__groupCacheInstalled) return sock;
  sock.__groupCacheInstalled = true;

  const original = sock.groupMetadata.bind(sock);
  fetchFresh = original;
  cache.clear();
  sock.groupMetadata = jid => fetchMetadata(jid);

  sock.ev.on('group-participants.update', ({ id }) => invalidate(id));
  sock.ev.on('groups.update', updates => { for (const u of updates || []) invalidate(u.id); });
  sock.ev.on('groups.upsert', groups => {
    for (const g of groups || []) if (g?.id && g.participants) cache.set(g.id, { data: g, ts: Date.now() });
  });

  return sock;
}

module.exports = { installGroupCache, cachedGroupMetadata };
