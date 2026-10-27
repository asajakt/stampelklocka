// Ren beräkningslogik: inga DOM- eller lagringsberoenden, så den kan testas med node.

export const DEFAULT_BREAKS = [
  { name: 'Frukost', start: '09:00', end: '09:15' },
  { name: 'Lunch', start: '12:00', end: '12:30' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

export function dateKey(d) {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfDay(d) {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

// Kalenderbaserat (inte +24 h) så att sommartidsskiften blir rätt.
function nextDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
}

function atTime(day, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const dt = new Date(day);
  dt.setHours(h, m, 0, 0);
  return dt.getTime();
}

function overlap(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

// Hur mycket av intervallet [from, to] som faller inom rasterna, dag för dag.
export function breakOverlapMs(from, to, breaks = DEFAULT_BREAKS) {
  let total = 0;
  for (let day = startOfDay(from); day.getTime() < to; day = nextDay(day)) {
    for (const b of breaks) {
      if (!b.start || !b.end) continue;
      total += overlap(from, to, atTime(day, b.start), atTime(day, b.end));
    }
  }
  return total;
}

export function activeStamps(stamps) {
  return stamps
    .filter((s) => !s.deleted)
    .slice()
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

// Para ihop In/Ut-stämplingar till arbetspass.
// Ett pass utan Ut som inte är det senaste markeras som ofullständigt och räknas inte.
export function buildSessions(stamps, now = Date.now()) {
  const sorted = activeStamps(stamps);
  const sessions = [];
  let open = null;

  for (const s of sorted) {
    if (s.type === 'in') {
      if (open) sessions.push({ in: open, out: null, problem: 'Saknar Ut' });
      open = s;
    } else if (open) {
      sessions.push({ in: open, out: s, problem: null });
      open = null;
    } else {
      sessions.push({ in: null, out: s, problem: 'Saknar In' });
    }
  }
  if (open) sessions.push({ in: open, out: null, problem: null, running: true });

  for (const sess of sessions) {
    sess.day = dateKey(Date.parse((sess.in || sess.out).ts));
    if (sess.problem) {
      sess.gross = sess.breaks = sess.net = 0;
      continue;
    }
    const from = Date.parse(sess.in.ts);
    const to = sess.out ? Date.parse(sess.out.ts) : Math.max(from, now);
    sess.gross = to - from;
    sess.breaks = 0;
    sess.net = sess.gross;
    sess.to = to;
  }
  return sessions;
}

export function applyBreaks(sessions, breaks = DEFAULT_BREAKS) {
  for (const sess of sessions) {
    if (sess.problem) continue;
    const from = Date.parse(sess.in.ts);
    sess.breaks = breakOverlapMs(from, sess.to, breaks);
    sess.net = sess.gross - sess.breaks;
  }
  return sessions;
}

export function computeSessions(stamps, breaks = DEFAULT_BREAKS, now = Date.now()) {
  return applyBreaks(buildSessions(stamps, now), breaks);
}

// Summering per dag: { 'YYYY-MM-DD': { gross, breaks, net, sessions: [] } }
export function summarizeByDay(sessions) {
  const days = {};
  for (const s of sessions) {
    const d = (days[s.day] ||= { day: s.day, gross: 0, breaks: 0, net: 0, sessions: [] });
    d.gross += s.gross;
    d.breaks += s.breaks;
    d.net += s.net;
    d.sessions.push(s);
  }
  return days;
}

// ISO-vecka (måndag först), t.ex. { year: 2026, week: 44 }
export function isoWeek(d) {
  const dt = new Date(d);
  const target = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return { year: target.getUTCFullYear(), week: Math.ceil(((target - yearStart) / DAY_MS + 1) / 7) };
}

export function weekKey(d) {
  const { year, week } = isoWeek(d);
  return `${year}-V${String(week).padStart(2, '0')}`;
}

export function formatDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  const sign = totalMin < 0 ? '-' : '';
  const abs = Math.abs(totalMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h} h ${String(m).padStart(2, '0')} min`;
}

export function formatDecimalHours(ms) {
  return (ms / 3600000).toFixed(2).replace('.', ',');
}
