// Synk mot Supabase via två RPC-funktioner (se supabase.sql).
// Tabellen är låst med RLS; bara den som känner till synknyckeln kommer åt sina rader.

const TIMEOUT_MS = 15000;

async function rpc(cfg, fn, body) {
  const base = cfg.url.replace(/\/+$/, '');
  // iOS kan frysa en förfrågan när appen hamnar i bakgrunden; ge upp efter en stund i stället för att hänga.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    cache: 'no-store',
    signal: ctrl.signal,
    headers: {
      apikey: cfg.anonKey,
      // Äldre anon-nycklar är JWT och skickas även som Bearer. Nya sb_publishable_-nycklar räcker i apikey.
      ...(cfg.anonKey.startsWith('eyJ') ? { Authorization: `Bearer ${cfg.anonKey}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }).catch((err) => {
    throw new Error(err.name === 'AbortError' ? 'Servern svarade inte i tid' : 'Kunde inte nå servern');
  }).finally(() => clearTimeout(timer));
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function normalize(row) {
  return {
    id: row.id,
    type: row.type,
    ts: new Date(row.ts).toISOString(),
    deleted: !!row.deleted,
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

// Slår ihop lokala och fjärr-stämplingar (senast ändrad vinner) och pushar lokala ändringar.
// Returnerar { merged, pushedIds } där pushedIds är id+updated_at som nu finns på servern.
export async function syncStamps(cfg, localStamps) {
  const remote = (await rpc(cfg, 'stamps_pull', { p_key: cfg.syncKey })).map(normalize);
  const byId = new Map(localStamps.map((s) => [s.id, s]));

  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l || Date.parse(r.updated_at) > Date.parse(l.updated_at)) {
      byId.set(r.id, { ...r, dirty: false });
    } else if (Date.parse(r.updated_at) === Date.parse(l.updated_at)) {
      byId.set(r.id, { ...l, dirty: false });
    }
  }

  const toPush = [...byId.values()].filter((s) => s.dirty);
  if (toPush.length) {
    await rpc(cfg, 'stamps_push', {
      p_key: cfg.syncKey,
      p_rows: toPush.map(({ id, type, ts, deleted, updated_at }) => ({ id, type, ts, deleted, updated_at })),
    });
  }

  const pushed = new Map(toPush.map((s) => [s.id, s.updated_at]));
  const merged = [...byId.values()].map((s) => (pushed.has(s.id) ? { ...s, dirty: false } : s));
  return { merged, pushed };
}

export function generateSyncKey() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
}
