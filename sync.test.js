import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncStamps } from './sync.js';

// Låtsas-Supabase som beter sig som stamps_pull/stamps_push i supabase.sql.
function fakeServer() {
  const rows = new Map();
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (url.endsWith('/rpc/stamps_pull')) {
      const out = [...rows.values()].filter((r) => r.sync_key === body.p_key);
      return { ok: true, text: async () => JSON.stringify(out) };
    }
    for (const r of body.p_rows) {
      const cur = rows.get(r.id);
      if (!cur || Date.parse(cur.updated_at) < Date.parse(r.updated_at)) rows.set(r.id, { ...r, sync_key: body.p_key });
    }
    return { ok: true, text: async () => '' };
  };
  return rows;
}

const cfg = { url: 'https://x.supabase.co/', anonKey: 'anon', syncKey: 'k'.repeat(24) };
const stamp = (id, type, ts, updated_at, extra = {}) => ({ id, type, ts, deleted: false, updated_at, dirty: true, ...extra });

test('telefon och dator får samma stämplingar', async () => {
  fakeServer();
  const phone = (await syncStamps(cfg, [stamp('a', 'in', '2026-10-27T06:00:00.000Z', '2026-10-27T06:00:00.000Z')])).merged;
  const pc = (await syncStamps(cfg, [stamp('b', 'out', '2026-10-27T15:00:00.000Z', '2026-10-27T15:00:00.000Z')])).merged;
  assert.deepEqual(pc.map((s) => s.id).sort(), ['a', 'b']);
  assert.ok(pc.every((s) => !s.dirty));
  const phone2 = (await syncStamps(cfg, phone)).merged;
  assert.deepEqual(phone2.map((s) => s.id).sort(), ['a', 'b']);
});

test('senaste ändringen vinner, borttagning synkas', async () => {
  fakeServer();
  await syncStamps(cfg, [stamp('a', 'in', '2026-10-27T06:00:00.000Z', '2026-10-27T06:00:00.000Z')]);
  const del = stamp('a', 'in', '2026-10-27T06:00:00.000Z', '2026-10-27T08:00:00.000Z', { deleted: true });
  await syncStamps(cfg, [del]);
  // En enhet med gammal version får borttagningen
  const old = (await syncStamps(cfg, [stamp('a', 'in', '2026-10-27T06:00:00.000Z', '2026-10-27T06:00:00.000Z', { dirty: false })])).merged;
  assert.equal(old[0].deleted, true);
});
