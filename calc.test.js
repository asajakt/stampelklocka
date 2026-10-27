import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSessions, summarizeByDay, formatDuration, isoWeek, breakOverlapMs } from './calc.js';

const H = 3600000;
const M = 60000;
let n = 0;
const st = (type, iso) => ({ id: String(++n), type, ts: new Date(iso).toISOString(), deleted: false });

test('heldag drar av frukost (15 min) och lunch (30 min)', () => {
  const s = computeSessions([st('in', '2026-10-26T07:00'), st('out', '2026-10-26T16:00')]);
  assert.equal(s[0].gross, 9 * H);
  assert.equal(s[0].breaks, 45 * M);
  assert.equal(s[0].net, 8 * H + 15 * M);
});

test('kommer efter frukost: bara lunch dras', () => {
  const s = computeSessions([st('in', '2026-10-26T10:00'), st('out', '2026-10-26T15:00')]);
  assert.equal(s[0].breaks, 30 * M);
});

test('går mitt i lunchen: bara överlappet dras', () => {
  const s = computeSessions([st('in', '2026-10-26T07:00'), st('out', '2026-10-26T12:10')]);
  assert.equal(s[0].breaks, 15 * M + 10 * M);
});

test('stämplar ut över lunch: rast dras inte dubbelt', () => {
  const s = computeSessions([
    st('in', '2026-10-26T07:00'), st('out', '2026-10-26T11:55'),
    st('in', '2026-10-26T12:40'), st('out', '2026-10-26T16:00'),
  ]);
  const day = summarizeByDay(s)['2026-10-26'];
  assert.equal(day.breaks, 15 * M);
  assert.equal(day.net, (4 * H + 55 * M - 15 * M) + (3 * H + 20 * M));
});

test('pågående pass räknas fram till nu', () => {
  const now = Date.parse(new Date('2026-10-26T08:30').toISOString());
  const s = computeSessions([st('in', '2026-10-26T07:00')], undefined, now);
  assert.equal(s[0].running, true);
  assert.equal(s[0].net, 90 * M);
});

test('glömd Ut-stämpling markeras och räknas inte', () => {
  const s = computeSessions([
    st('in', '2026-10-26T07:00'),
    st('in', '2026-10-27T07:00'), st('out', '2026-10-27T08:00'),
  ]);
  assert.equal(s[0].problem, 'Saknar Ut');
  assert.equal(s[0].net, 0);
  assert.equal(s[1].net, H);
});

test('borttagna stämplingar ignoreras', () => {
  const s = computeSessions([
    st('in', '2026-10-26T07:00'),
    { ...st('out', '2026-10-26T08:00'), deleted: true },
    st('out', '2026-10-26T10:00'),
  ]);
  assert.equal(s.length, 1);
  assert.equal(s[0].gross, 3 * H);
});

test('pass över midnatt drar rast för båda dygnen', () => {
  const ms = breakOverlapMs(Date.parse('2026-10-26T08:00'), Date.parse('2026-10-27T13:00'));
  assert.equal(ms, 90 * M);
});

test('formatering och veckonummer', () => {
  assert.equal(formatDuration(8 * H + 5 * M), '8 h 05 min');
  assert.deepEqual(isoWeek(new Date('2026-10-27T12:00')), { year: 2026, week: 44 });
  assert.deepEqual(isoWeek(new Date('2027-01-01T12:00')), { year: 2026, week: 53 });
});
