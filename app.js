import {
  DEFAULT_BREAKS, computeSessions, summarizeByDay, activeStamps,
  dateKey, weekKey, isoWeek, formatDuration, formatDecimalHours,
} from './calc.js';
import { syncStamps, generateSyncKey } from './sync.js';

const DATA_KEY = 'stampelklocka:data';
const SYNC_KEY = 'stampelklocka:sync';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const timeFmt = new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const longDateFmt = new Intl.DateTimeFormat('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' });
const dayFmt = new Intl.DateTimeFormat('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' });
const monthFmt = new Intl.DateTimeFormat('sv-SE', { month: 'long', year: 'numeric' });

// ---------- State ----------

function loadJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

const state = {
  ...{ stamps: [], breaks: DEFAULT_BREAKS },
  ...loadJSON(DATA_KEY, {}),
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
};
let syncCfg = loadJSON(SYNC_KEY, null);

function save() {
  localStorage.setItem(DATA_KEY, JSON.stringify({ stamps: state.stamps, breaks: state.breaks }));
}

function upsertStamp(stamp) {
  const updated = { ...stamp, updated_at: new Date().toISOString(), dirty: true };
  const i = state.stamps.findIndex((s) => s.id === stamp.id);
  if (i >= 0) state.stamps[i] = updated;
  else state.stamps.push(updated);
  save();
  render();
  scheduleSync();
}

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function lastStamp() {
  const active = activeStamps(state.stamps);
  return active[active.length - 1];
}

// ---------- Stämpla ----------

function stampNow() {
  const last = lastStamp();
  const type = last?.type === 'in' ? 'out' : 'in';
  upsertStamp({ id: newId(), type, ts: new Date().toISOString(), deleted: false });
  toast(type === 'in' ? `Instämplad ${timeFmt.format(new Date())}` : `Utstämplad ${timeFmt.format(new Date())}`);
  navigator.vibrate?.(30);
}

function renderStampla({ list = true } = {}) {
  const now = new Date();
  $('clock-time').textContent = timeFmt.format(now);
  $('clock-date').textContent = longDateFmt.format(now);

  const last = lastStamp();
  const isIn = last?.type === 'in';
  const btn = $('stamp-btn');
  btn.textContent = isIn ? 'UT' : 'IN';
  btn.classList.toggle('out', isIn);
  $('status').innerHTML = isIn
    ? `Instämplad sedan <strong>${timeFmt.format(new Date(last.ts))}</strong>${dateKey(last.ts) !== dateKey(now) ? ` (${dayFmt.format(new Date(last.ts))})` : ''}`
    : last ? `Utstämplad ${timeFmt.format(new Date(last.ts))}` : 'Inte instämplad';

  const days = summarizeByDay(computeSessions(state.stamps, state.breaks));
  const today = days[dateKey(now)];
  $('today-net').textContent = formatDuration(today?.net ?? 0);
  $('today-breaks').textContent = today?.breaks ? `Raster avdragna: ${Math.round(today.breaks / 60000)} min` : 'Inga raster avdragna';

  const wk = weekKey(now);
  const weekDays = Object.values(days).filter((d) => weekKey(new Date(d.day + 'T12:00')) === wk);
  $('week-label').textContent = `Vecka ${isoWeek(now).week}`;
  $('week-net').textContent = formatDuration(weekDays.reduce((a, d) => a + d.net, 0));
  $('week-days').textContent = `${weekDays.filter(hasWork).length} arbetsdagar`;

  if (!list) return;
  const todays = activeStamps(state.stamps).filter((s) => dateKey(s.ts) === dateKey(now));
  $('today-list').innerHTML = todays.length
    ? todays.map((s) => `
        <li data-id="${esc(s.id)}">
          <span class="badge ${s.type}">${s.type === 'in' ? 'IN' : 'UT'}</span>
          <span class="stamp-time">${timeFmt.format(new Date(s.ts))}</span>
          <span class="edit-hint">Ändra</span>
        </li>`).join('')
    : '<li class="empty">Inga stämplingar ännu idag</li>';
}

const hasWork = (d) => d.sessions.some((s) => !s.problem);

// ---------- Historik ----------

function renderHistorik() {
  const m = state.month;
  $('month-title').textContent = monthFmt.format(m);
  const monthPrefix = dateKey(m).slice(0, 7);

  const sessions = computeSessions(state.stamps, state.breaks);
  const days = Object.values(summarizeByDay(sessions))
    .filter((d) => d.day.startsWith(monthPrefix))
    .sort((a, b) => b.day.localeCompare(a.day));

  const total = days.reduce((a, d) => a + d.net, 0);
  const breaks = days.reduce((a, d) => a + d.breaks, 0);
  const problems = days.reduce((a, d) => a + d.sessions.filter((s) => s.problem).length, 0);
  $('month-net').textContent = `${formatDuration(total)}  (${formatDecimalHours(total)} h)`;
  $('month-sub').textContent = `${days.filter(hasWork).length} arbetsdagar · raster avdragna ${formatDuration(breaks)}`
    + (problems ? ` · ⚠️ ${problems} ofullständiga pass` : '');

  const weeks = new Map();
  for (const d of days) {
    const wk = weekKey(new Date(d.day + 'T12:00'));
    if (!weeks.has(wk)) weeks.set(wk, []);
    weeks.get(wk).push(d);
  }

  if (!days.length) {
    $('history').innerHTML = '<p class="hint" style="text-align:center">Inga stämplingar denna månad.</p>';
    return;
  }

  $('history').innerHTML = [...weeks.entries()].map(([wk, wdays]) => `
    <div class="week">
      <div class="week-head"><span>Vecka ${Number(wk.split('-V')[1])}</span><strong>${formatDuration(wdays.reduce((a, d) => a + d.net, 0))}</strong></div>
      ${wdays.map(renderDay).join('')}
    </div>`).join('');
}

function renderDay(d) {
  const chips = d.sessions.map((s) => {
    const inT = s.in ? timeFmt.format(new Date(s.in.ts)) : '??';
    const outT = s.out ? timeFmt.format(new Date(s.out.ts)) : s.running ? 'pågår' : '??';
    const inChip = s.in ? `data-id="${esc(s.in.id)}"` : `data-add="in" data-day="${d.day}"`;
    const outChip = s.out ? `data-id="${esc(s.out.id)}"` : s.running ? '' : `data-add="out" data-day="${d.day}"`;
    const cls = s.problem ? 'chip problem' : 'chip';
    const title = s.problem ? ` title="${esc(s.problem)}"` : '';
    return `<span class="${cls}"${title}><span ${inChip}>${inT}</span>–<span ${outChip}>${outT}</span>${s.problem ? ' ⚠️' : ''}</span>`;
  }).join('');
  return `
    <div class="day">
      <div class="day-head">
        <span class="day-name">${dayFmt.format(new Date(d.day + 'T12:00'))}</span>
        <span class="day-net">${formatDuration(d.net)}</span>
      </div>
      <div class="day-sessions">${chips}</div>
      ${d.breaks ? `<div class="day-sub">Brutto ${formatDuration(d.gross)} − raster ${Math.round(d.breaks / 60000)} min</div>` : ''}
    </div>`;
}

function exportCsv() {
  const monthPrefix = dateKey(state.month).slice(0, 7);
  const sessions = computeSessions(state.stamps, state.breaks)
    .filter((s) => s.day.startsWith(monthPrefix))
    .sort((a, b) => a.day.localeCompare(b.day));
  const rows = [['Datum', 'Vecka', 'In', 'Ut', 'Brutto (h)', 'Raster (min)', 'Netto (h)', 'Anmärkning']];
  for (const s of sessions) {
    rows.push([
      s.day,
      isoWeek(new Date(s.day + 'T12:00')).week,
      s.in ? timeFmt.format(new Date(s.in.ts)) : '',
      s.out ? timeFmt.format(new Date(s.out.ts)) : '',
      formatDecimalHours(s.gross),
      Math.round(s.breaks / 60000),
      formatDecimalHours(s.net),
      s.problem || (s.running ? 'Pågår' : ''),
    ]);
  }
  const total = sessions.reduce((a, s) => a + s.net, 0);
  rows.push(['Totalt', '', '', '', '', '', formatDecimalHours(total), '']);
  // Semikolon + BOM så att svenska Excel öppnar filen rätt.
  const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  download(`arbetstid-${monthPrefix}.csv`, csv, 'text/csv;charset=utf-8');
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Inställningar ----------

function renderBreaks() {
  $('breaks').innerHTML = state.breaks.map((b, i) => `
    <div class="break-row" data-i="${i}">
      <input data-f="name" value="${esc(b.name)}" aria-label="Namn">
      <input data-f="start" type="text" inputmode="numeric" maxlength="5" placeholder="TT:MM" pattern="([01]?[0-9]|2[0-3])[:.]?[0-5][0-9]" value="${esc(b.start)}" aria-label="Start">
      <input data-f="end" type="text" inputmode="numeric" maxlength="5" placeholder="TT:MM" pattern="([01]?[0-9]|2[0-3])[:.]?[0-5][0-9]" value="${esc(b.end)}" aria-label="Slut">
      <button data-remove="${i}" type="button" aria-label="Ta bort">✕</button>
    </div>`).join('');
}

function renderSyncFields() {
  $('sync-url').value = syncCfg?.url ?? '';
  $('sync-anon').value = syncCfg?.anonKey ?? '';
  $('sync-key').value = syncCfg?.syncKey ?? '';
  setSyncStatus();
}

function setSyncStatus(msg) {
  if (msg) {
    $('sync-status').textContent = msg;
  } else if (!syncCfg) {
    $('sync-status').textContent = 'Synk är avstängd.';
  } else {
    const t = syncCfg.lastSync ? `${dayFmt.format(new Date(syncCfg.lastSync))} ${timeFmt.format(new Date(syncCfg.lastSync))}` : 'aldrig';
    $('sync-status').textContent = `Synk på. Senast synkad: ${t}`;
  }
}

// ---------- Synk ----------

let syncTimer = null;
let syncing = false;

function scheduleSync(delay = 500) {
  if (!syncCfg) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, delay);
}

// Returnerar true om synken gick igenom.
async function runSync({ manual = false } = {}) {
  if (!syncCfg || syncing) return false;
  if (!navigator.onLine) {
    if (manual) setSyncStatus('Offline – synkar när du är online igen.');
    return false;
  }
  syncing = true;
  const snapshot = state.stamps;
  try {
    const { merged } = await syncStamps(syncCfg, snapshot);
    // Behåll ändringar som gjordes medan synken pågick.
    const before = new Map(snapshot.map((s) => [s.id, s.updated_at]));
    const result = new Map(merged.map((s) => [s.id, s]));
    for (const s of state.stamps) {
      if (before.get(s.id) !== s.updated_at) result.set(s.id, s);
    }
    state.stamps = [...result.values()];
    save();
    syncCfg.lastSync = new Date().toISOString();
    localStorage.setItem(SYNC_KEY, JSON.stringify(syncCfg));
    setSyncStatus();
    render();
    if (state.stamps.some((s) => s.dirty)) scheduleSync();
    return true;
  } catch (err) {
    setSyncStatus(`Synkfel: ${err.message}`);
    if (manual) toast('Synk misslyckades');
    return false;
  } finally {
    syncing = false;
  }
}

// ---------- Dra ner för att synka ----------

const PULL_TRIGGER = 70; // px indikatorn ska dras ner innan synk startar
let pullStartY = null;
let pullOffset = 0;
let pulling = false;

function setPull(offset, text) {
  const el = $('pull');
  el.style.transform = `translate(-50%, ${offset - 56}px)`;
  el.style.opacity = Math.min(1, offset / PULL_TRIGGER);
  if (text) el.querySelector('span').textContent = text;
}

document.addEventListener('touchstart', (e) => {
  if (pulling || window.scrollY > 0 || e.touches.length !== 1 || $('edit-dialog').open) return;
  pullStartY = e.touches[0].clientY;
  pullOffset = 0;
  $('pull').classList.remove('anim');
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  if (pullStartY === null) return;
  if (window.scrollY > 0) {
    pullStartY = null;
    setPull(0);
    return;
  }
  // Halva fingerrörelsen, så det känns lite trögt som i andra appar.
  pullOffset = Math.min(Math.max(0, e.touches[0].clientY - pullStartY) / 2, PULL_TRIGGER + 20);
  const ready = pullOffset >= PULL_TRIGGER;
  $('pull').classList.toggle('ready', ready);
  setPull(pullOffset, ready ? 'Släpp för att synka' : 'Dra ner för att synka');
}, { passive: true });

document.addEventListener('touchend', async () => {
  if (pullStartY === null) return;
  pullStartY = null;
  const el = $('pull');
  el.classList.add('anim');
  if (pullOffset < PULL_TRIGGER) {
    setPull(0);
    return;
  }
  pulling = true;
  navigator.vibrate?.(15);
  el.classList.add('spinning');
  el.querySelector('b').textContent = '⟳';
  setPull(PULL_TRIGGER, 'Synkar…');
  if (!syncCfg) {
    toast('Synk är inte påslagen – se Inställningar');
  } else if (await runSync({ manual: true })) {
    toast('Synkad');
  }
  el.classList.remove('spinning', 'ready');
  el.querySelector('b').textContent = '↓';
  setPull(0);
  pulling = false;
});

// ---------- Redigera ----------

let editing = null;

function hhmm(d) {
  const dt = new Date(d);
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

// Tolkar 24-timmarstid som "7:05", "07.05" eller "0705". Returnerar "07:05" eller null.
function parseTime(text) {
  const m = String(text).trim().match(/^(\d{1,2})[:.]?(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

// Utan id: ny stämpling. preset = { type, day } förifyller t.ex. en glömd Ut-stämpling.
function openEdit(id, preset = null) {
  const stamp = id ? state.stamps.find((s) => s.id === id) : null;
  editing = stamp;
  $('edit-title').textContent = stamp ? 'Ändra stämpling' : 'Ny stämpling';
  $('edit-type').value = stamp?.type ?? preset?.type ?? (lastStamp()?.type === 'in' ? 'out' : 'in');
  const defaultTs = preset ? new Date(`${preset.day}T${preset.type === 'in' ? '07:00' : '16:00'}`) : new Date();
  const ts = stamp?.ts ?? defaultTs;
  $('edit-date').value = dateKey(ts);
  $('edit-time').value = hhmm(ts);
  $('edit-delete').hidden = !stamp;
  $('edit-dialog').showModal();
}

$('edit-dialog').addEventListener('close', () => {
  const action = $('edit-dialog').returnValue;
  const time = parseTime($('edit-time').value);
  if (action === 'save' && $('edit-date').value && time) {
    upsertStamp({
      id: editing?.id ?? newId(),
      type: $('edit-type').value,
      ts: new Date(`${$('edit-date').value}T${time}`).toISOString(),
      deleted: false,
    });
  } else if (action === 'delete' && editing) {
    if (confirm('Ta bort stämplingen?')) upsertStamp({ ...editing, deleted: true });
  }
  editing = null;
});

// ---------- Allmänt ----------

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

function render() {
  renderStampla();
  if ($('view-historik').classList.contains('active')) renderHistorik();
}

function showView(name) {
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('active', v.id === `view-${name}`);
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('active', b.dataset.view === name);
  if (name === 'historik') renderHistorik();
  if (name === 'installningar') { renderBreaks(); renderSyncFields(); }
  window.scrollTo(0, 0);
}

// ---------- Händelser ----------

$('stamp-btn').addEventListener('click', stampNow);
$('add-btn').addEventListener('click', () => openEdit(null));

$('today-list').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (li) openEdit(li.dataset.id);
});
$('history').addEventListener('click', (e) => {
  const el = e.target.closest('[data-id], [data-add]');
  if (el?.dataset.id) openEdit(el.dataset.id);
  else if (el) openEdit(null, { type: el.dataset.add, day: el.dataset.day });
});

for (const b of document.querySelectorAll('.tabs button')) {
  b.addEventListener('click', () => showView(b.dataset.view));
}

$('month-prev').addEventListener('click', () => {
  state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
  renderHistorik();
});
$('month-next').addEventListener('click', () => {
  state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
  renderHistorik();
});
$('export-csv').addEventListener('click', exportCsv);

$('breaks').addEventListener('change', (e) => {
  const row = e.target.closest('.break-row');
  if (!row || !e.target.dataset.f) return;
  const i = Number(row.dataset.i);
  let value = e.target.value;
  if (e.target.dataset.f !== 'name') {
    value = parseTime(value);
    if (!value) {
      toast('Skriv tiden som TT:MM, t.ex. 09:15');
      e.target.value = state.breaks[i][e.target.dataset.f];
      return;
    }
    e.target.value = value;
  }
  state.breaks[i] = { ...state.breaks[i], [e.target.dataset.f]: value };
  const b = state.breaks[i];
  if (b.start && b.end && b.start >= b.end) toast('Slut måste vara efter start');
  save();
  render();
});
$('breaks').addEventListener('click', (e) => {
  const i = e.target.dataset.remove;
  if (i === undefined) return;
  state.breaks.splice(Number(i), 1);
  save();
  renderBreaks();
  render();
});
$('break-add').addEventListener('click', () => {
  state.breaks.push({ name: 'Rast', start: '15:00', end: '15:15' });
  save();
  renderBreaks();
  render();
});
$('break-reset').addEventListener('click', () => {
  state.breaks = structuredClone(DEFAULT_BREAKS);
  save();
  renderBreaks();
  render();
});

$('sync-gen').addEventListener('click', () => {
  if ($('sync-key').value && !confirm('Skapa en ny nyckel? Andra enheter måste då få samma nya nyckel.')) return;
  $('sync-key').value = generateSyncKey();
});
$('sync-save').addEventListener('click', async () => {
  const url = $('sync-url').value.trim();
  const anonKey = $('sync-anon').value.trim();
  const syncKey = $('sync-key').value.trim();
  if (!url || !anonKey || syncKey.length < 20) {
    setSyncStatus('Fyll i URL, publishable key och en synknyckel (minst 20 tecken – tryck "Skapa").');
    return;
  }
  syncCfg = { url, anonKey, syncKey, lastSync: null };
  localStorage.setItem(SYNC_KEY, JSON.stringify(syncCfg));
  // Allt lokalt ska upp till servern första gången.
  state.stamps = state.stamps.map((s) => ({ ...s, updated_at: s.updated_at ?? new Date().toISOString(), dirty: true }));
  save();
  setSyncStatus('Synkar…');
  await runSync({ manual: true });
  if (syncCfg?.lastSync) toast('Synk klar');
});
$('sync-off').addEventListener('click', () => {
  syncCfg = null;
  localStorage.removeItem(SYNC_KEY);
  renderSyncFields();
});

$('backup-export').addEventListener('click', () => {
  download(`stampelklocka-backup-${dateKey(new Date())}.json`,
    JSON.stringify({ stamps: state.stamps, breaks: state.breaks }, null, 2), 'application/json');
});
$('backup-import').addEventListener('click', () => $('backup-file').click());
$('backup-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.stamps)) throw new Error('Saknar stämplingar');
    const byId = new Map(state.stamps.map((s) => [s.id, s]));
    for (const s of data.stamps) {
      const cur = byId.get(s.id);
      if (!cur || Date.parse(s.updated_at ?? 0) > Date.parse(cur.updated_at ?? 0)) {
        byId.set(s.id, { ...s, updated_at: s.updated_at ?? new Date().toISOString(), dirty: true });
      }
    }
    state.stamps = [...byId.values()];
    if (Array.isArray(data.breaks)) state.breaks = data.breaks;
    save();
    renderBreaks();
    render();
    scheduleSync();
    toast(`Importerade ${data.stamps.length} stämplingar`);
  } catch (err) {
    toast(`Kunde inte importera: ${err.message}`);
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    render();
    scheduleSync(0);
  }
});
window.addEventListener('online', () => scheduleSync(0));

// Hämta ändringar från andra enheter regelbundet medan appen är öppen.
const SYNC_INTERVAL_MS = 60 * 1000;
setInterval(() => {
  if (document.visibilityState === 'visible') scheduleSync(0);
}, SYNC_INTERVAL_MS);

// Uppdatera klockan och pågående tid varje sekund du tittar på appen.
setInterval(() => {
  if (document.visibilityState === 'visible') renderStampla({ list: false });
}, 1000);

render();
scheduleSync(0);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
