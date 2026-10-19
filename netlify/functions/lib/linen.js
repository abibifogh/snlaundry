// Bed linen and towels, tracked piece by piece.
//
// Every sheet, pillowcase and towel has its own code (L00001, L00002 …) printed
// on a QR label. A piece is always in exactly one state:
//
//   clean    — folded, in the storeroom or a room's cupboard (loc)
//   in_use   — on a bed, or in a room's bathroom (room + bed; bed null = towels)
//   soiled   — taken off, waiting to go to the wash
//   washing  — in a wash batch
//   missing  — expected somewhere and not found; stays here until found or written off
//   retired  — out of stock for good: damaged, worn out, lost or charged to a guest
//
// The loop is clean → in_use → soiled → washing → clean. A piece only leaves it
// through missing or retired, and every move is written to the log with who did
// it, so the totals always add up and nothing disappears without a name on it.
//
// Everything lives in one document (key "linen"), the same way the rest of the
// app keeps its data: a property has hundreds of pieces, not millions.

import { readJSON, writeJSON } from './store.js';
import { newId } from './auth.js';

const K_LINEN = 'linen';
const LOG_CAP = 5000;

export const BED_SIZES = ['Single', 'Double', 'Queen', 'King'];
export const PIECE_STATUSES = ['clean', 'in_use', 'soiled', 'washing', 'missing', 'retired'];
export const RETIRE_REASONS = { damaged: 'Damaged', worn: 'Worn out', lost: 'Lost', charged: 'Charged to guest' };
const CATEGORIES = ['bed', 'bath'];

// The defaults follow the room setups in the laundry handbook: double sheets are
// used both on the bed and as the cover sheet; queen and king beds take one big
// sheet with two double sheets as covers; towels depend on the room, not the bed.
export function defaultLinen() {
  return {
    par: 3, // sets per bed / bathroom: one in use, one in the wash, one on the shelf
    bedChangeDays: 3,
    towelChangeDays: 1,
    washAlertHours: 24,
    types: [
      { id: 'dsheet', name: 'Double sheet', category: 'bed', cost: 0, washLife: 200, active: true },
      { id: 'bsheet', name: 'Big sheet', category: 'bed', cost: 0, washLife: 200, active: true },
      { id: 'pcase', name: 'Pillowcase', category: 'bed', cost: 0, washLife: 250, active: true },
      { id: 'btowel', name: 'Body towel', category: 'bath', cost: 0, washLife: 150, active: true },
      { id: 'htowel', name: 'Hand towel', category: 'bath', cost: 0, washLife: 150, active: true },
      { id: 'ftowel', name: 'Floor towel', category: 'bath', cost: 0, washLife: 150, active: true },
    ],
    bedSets: {
      Single: { dsheet: 2, pcase: 1 },
      Double: { dsheet: 2, pcase: 1 },
      Queen: { bsheet: 1, dsheet: 2, pcase: 2 },
      King: { bsheet: 1, dsheet: 2, pcase: 2 },
    },
    rooms: [], // { name, cupboard, beds: [{ id, label, size, state, changedAt }], towels: {typeId: n}, towelsState, towelsChangedAt, checkoutAt }
    pieces: [], // { code, typeId, status, loc, room, bed, washes, cost, supplier, addedAt, statusAt, batchId, missingFrom, retiredReason, note }
    batches: [], // { id, number, sentAt, sentBy, codes, status, receivedAt, receivedBy, back, rewash, damaged, missing }
    log: [], // { id, at, by, role, action, detail, codes }
    seq: { piece: 0, batch: 0 },
  };
}

export async function getLinen() {
  const d = await readJSON(K_LINEN, null);
  const def = defaultLinen();
  if (!d) return def;
  return { ...def, ...d, seq: { ...def.seq, ...(d.seq || {}) }, bedSets: { ...def.bedSets, ...(d.bedSets || {}) } };
}

async function mutate(fn) {
  const d = await getLinen();
  const result = await fn(d);
  await writeJSON(K_LINEN, d);
  return result === undefined ? d : result;
}

// What staff see: everything except the older log entries.
export async function linenView() {
  const d = await getLinen();
  return { ...d, log: d.log.slice(-400) };
}

// ------------------------------------------------------------------- setup ---
export async function saveLinenSetup(patch = {}, actor) {
  return mutate((d) => {
    if (patch.par != null) d.par = clampInt(patch.par, 1, 10, 3);
    if (patch.bedChangeDays != null) d.bedChangeDays = clampInt(patch.bedChangeDays, 1, 60, 3);
    if (patch.towelChangeDays != null) d.towelChangeDays = clampInt(patch.towelChangeDays, 1, 60, 1);
    if (patch.washAlertHours != null) d.washAlertHours = clampInt(patch.washAlertHours, 1, 240, 24);

    if (Array.isArray(patch.types)) {
      const seen = new Set();
      const next = patch.types.map((t) => {
        const name = String(t.name || '').trim();
        if (!name) throw httpError(400, 'Every item needs a name.');
        const id = t.id && d.types.some((x) => x.id === t.id) ? t.id : slugId(name, d.types);
        if (seen.has(id)) throw httpError(400, `"${name}" is listed twice.`);
        seen.add(id);
        return {
          id, name,
          category: CATEGORIES.includes(t.category) ? t.category : 'bed',
          cost: Math.max(0, Number(t.cost) || 0),
          washLife: clampInt(t.washLife, 10, 2000, 200),
          active: t.active !== false,
        };
      });
      // A type that still has pieces can be hidden, never deleted.
      d.types.forEach((old) => {
        if (!seen.has(old.id) && d.pieces.some((p) => p.typeId === old.id)) {
          next.push({ ...old, active: false });
        }
      });
      d.types = next;
    }
    const typeIds = new Set(d.types.map((t) => t.id));

    if (patch.bedSets && typeof patch.bedSets === 'object') {
      const sets = {};
      BED_SIZES.forEach((size) => { sets[size] = cleanSet(patch.bedSets[size] || d.bedSets[size] || {}, typeIds); });
      d.bedSets = sets;
    }

    if (Array.isArray(patch.rooms)) {
      const names = new Set();
      const next = patch.rooms.map((r) => {
        const name = String(r.name || '').trim();
        if (!name) throw httpError(400, 'Every room needs a name.');
        if (names.has(name.toLowerCase())) throw httpError(400, `Room "${name}" is listed twice.`);
        names.add(name.toLowerCase());
        const old = d.rooms.find((x) => x.name === (r.originalName || name)) || {};
        const beds = (Array.isArray(r.beds) ? r.beds : []).map((b, i) => {
          const prev = (old.beds || []).find((x) => x.id === b.id);
          return {
            id: prev ? prev.id : newId('bed'),
            label: String(b.label || '').trim() || `Bed ${i + 1}`,
            size: BED_SIZES.includes(b.size) ? b.size : 'Double',
            state: prev ? prev.state : 'stripped',
            changedAt: prev ? prev.changedAt : null,
          };
        });
        return {
          name,
          cupboard: !!r.cupboard,
          beds,
          towels: cleanSet(r.towels || {}, typeIds),
          towelsState: old.towelsState || 'stripped',
          towelsChangedAt: old.towelsChangedAt || null,
          checkoutAt: old.checkoutAt || null,
          _from: old.name || null,
        };
      });
      // Pieces in use on a bed that no longer exists, or clean in a cupboard that
      // was switched off, would be stranded — refuse rather than lose track.
      for (const p of d.pieces) {
        if (p.status === 'in_use') {
          const room = next.find((r) => r._from === p.room);
          if (!room || (p.bed && !room.beds.some((b) => b.id === p.bed))) {
            throw httpError(400, `${p.code} is still on ${p.room}${p.bed ? ' ' + bedLabel(d, p.room, p.bed) : ''}. Change that bed before removing it.`);
          }
        }
        if (p.status === 'clean' && p.loc !== 'store') {
          const room = next.find((r) => r._from === p.loc);
          if (!room || !room.cupboard) throw httpError(400, `${p.code} is in the ${p.loc} cupboard. Move it out before removing that cupboard.`);
        }
      }
      // Follow renames.
      for (const r of next) {
        if (r._from && r._from !== r.name) {
          d.pieces.forEach((p) => {
            if (p.room === r._from) p.room = r.name;
            if (p.loc === r._from) p.loc = r.name;
          });
        }
        delete r._from;
      }
      d.rooms = next;
    }
    addLog(d, actor, 'Setup changed', 'Rooms, items or par levels updated');
    return d;
  });
}

// ------------------------------------------------------------- new pieces ---
export async function addPieces({ typeId, qty, cost, supplier, loc = 'store' } = {}, actor) {
  return mutate((d) => {
    const t = d.types.find((x) => x.id === typeId);
    if (!t) throw httpError(400, 'Choose an item type.');
    const n = clampInt(qty, 0, 500, 0);
    if (n < 1) throw httpError(400, 'Quantity must be between 1 and 500.');
    checkLoc(d, loc);
    const unit = cost != null && cost !== '' ? Math.max(0, Number(cost) || 0) : t.cost;
    const at = nowIso();
    const codes = [];
    for (let i = 0; i < n; i++) {
      d.seq.piece += 1;
      const code = 'L' + String(d.seq.piece).padStart(5, '0');
      d.pieces.push({
        code, typeId: t.id, status: 'clean', loc, room: null, bed: null, washes: 0,
        cost: unit, supplier: String(supplier || '').trim(), addedAt: at, statusAt: at,
        batchId: null, missingFrom: null, retiredReason: null, note: '',
      });
      codes.push(code);
    }
    if (unit) t.cost = unit; // the last price paid becomes the reorder price
    addLog(d, actor, 'New stock', `${n} × ${t.name.toLowerCase()} into ${locName(loc)}`, codes);
    return { codes };
  });
}

// ------------------------------------------------- change a bed or towels ---
// Everything currently in the place either comes off (soiled), stays, or is
// reported missing. Then the pieces going on must each be clean.
export async function changePlace({ room, bed = null, off = [], keep = [], on = [] } = {}, actor) {
  return mutate((d) => {
    const r = d.rooms.find((x) => x.name === room);
    if (!r) throw httpError(404, 'Room not found.');
    const b = bed ? r.beds.find((x) => x.id === bed) : null;
    if (bed && !b) throw httpError(404, 'Bed not found.');
    const where = bed ? `${room} ${b.label}` : `${room} towels`;
    const current = d.pieces.filter((p) => p.status === 'in_use' && p.room === room && (p.bed || null) === (bed || null));
    const curCodes = new Set(current.map((p) => p.code));
    const offC = codesOf(off), keepC = codesOf(keep), onC = codesOf(on);
    for (const c of [...offC, ...keepC]) if (!curCodes.has(c)) throw httpError(400, `${c} isn't recorded on ${where}.`);
    const overlap = offC.find((c) => keepC.includes(c));
    if (overlap) throw httpError(400, `${overlap} can't both come off and stay.`);
    const onPieces = onC.map((c) => {
      const p = pieceOr404(d, c);
      if (curCodes.has(c)) throw httpError(400, `${c} is already on ${where}.`);
      if (!['clean', 'missing'].includes(p.status)) throw httpError(400, `${c} is ${statusWord(p)}. Only clean linen can go on.`);
      return p;
    });
    const at = nowIso();
    const missing = [];
    current.forEach((p) => {
      if (offC.includes(p.code)) setStatus(p, 'soiled', at);
      else if (!keepC.includes(p.code)) { setStatus(p, 'missing', at); p.missingFrom = `Not found on ${where}`; missing.push(p.code); }
    });
    onPieces.forEach((p) => { setStatus(p, 'in_use', at); p.room = room; p.bed = bed || null; });

    const filled = onC.length + keepC.length > 0;
    if (b) { b.state = filled ? 'made' : 'stripped'; if (onC.length) b.changedAt = at; }
    else { r.towelsState = filled ? 'made' : 'stripped'; if (onC.length) r.towelsChangedAt = at; }
    if (r.checkoutAt && placesOf(r).every((pl) => pl.changedAt && pl.changedAt >= r.checkoutAt)) r.checkoutAt = null;

    const parts = [];
    if (offC.length) parts.push(`${offC.length} off`);
    if (onC.length) parts.push(`${onC.length} on`);
    if (missing.length) parts.push(`${missing.length} missing`);
    addLog(d, actor, onC.length ? `Changed ${where}` : `Stripped ${where}`, parts.join(', ') || 'No change', [...offC, ...onC, ...missing]);
    return { ok: true, missing };
  });
}

export async function markCheckout({ room } = {}, actor) {
  return mutate((d) => {
    const r = d.rooms.find((x) => x.name === room);
    if (!r) throw httpError(404, 'Room not found.');
    r.checkoutAt = nowIso();
    addLog(d, actor, `Checked out ${room}`, 'Beds and towels due a change');
    return { ok: true };
  });
}

// --------------------------------------------------------------- the wash ---
export async function sendToWash({ codes } = {}, actor) {
  return mutate((d) => {
    const list = codesOf(codes);
    if (!list.length) throw httpError(400, 'Choose the pieces going into the wash.');
    const pieces = list.map((c) => {
      const p = pieceOr404(d, c);
      if (p.status !== 'soiled') throw httpError(400, `${c} is ${statusWord(p)}, not in the soiled bin.`);
      return p;
    });
    d.seq.batch += 1;
    const batch = {
      id: newId('wb'), number: 'W-' + String(d.seq.batch).padStart(4, '0'),
      sentAt: nowIso(), sentBy: actorName(actor), codes: list, status: 'washing',
      receivedAt: null, receivedBy: null, back: [], rewash: [], damaged: [], missing: [],
    };
    pieces.forEach((p) => { setStatus(p, 'washing', batch.sentAt); p.batchId = batch.id; });
    d.batches.push(batch);
    addLog(d, actor, `Sent ${batch.number} to wash`, `${list.length} pieces`, list);
    return batch;
  });
}

// Count the batch back. Anything not scanned back, re-wash or damaged is missing.
export async function receiveBatch(id, { back = [], rewash = [], damaged = [], loc = 'store', note = '' } = {}, actor) {
  return mutate((d) => {
    const batch = d.batches.find((b) => b.id === id);
    if (!batch) throw httpError(404, 'Wash batch not found.');
    if (batch.status !== 'washing') throw httpError(400, `${batch.number} has already been received.`);
    checkLoc(d, loc);
    const backC = codesOf(back), rewashC = codesOf(rewash), dmgC = codesOf(damaged);
    const all = [...backC, ...rewashC, ...dmgC];
    const inBatch = new Set(batch.codes);
    for (const c of all) if (!inBatch.has(c)) throw httpError(400, `${c} wasn't sent in ${batch.number}.`);
    if (new Set(all).size !== all.length) throw httpError(400, 'A piece can only be counted once.');
    const at = nowIso();
    const missing = [];
    batch.codes.forEach((c) => {
      const p = d.pieces.find((x) => x.code === c);
      if (!p || p.status !== 'washing' || p.batchId !== batch.id) return; // already found/moved some other way
      p.batchId = null;
      if (backC.includes(c)) { p.washes += 1; setStatus(p, 'clean', at); p.loc = loc; }
      else if (rewashC.includes(c)) { p.washes += 1; setStatus(p, 'soiled', at); }
      else if (dmgC.includes(c)) { p.washes += 1; retire(p, 'damaged', note || `Damaged in ${batch.number}`, at); }
      else { setStatus(p, 'missing', at); p.missingFrom = `Short from ${batch.number}`; missing.push(c); }
    });
    Object.assign(batch, {
      status: missing.length ? 'short' : 'received', receivedAt: at, receivedBy: actorName(actor),
      back: backC, rewash: rewashC, damaged: dmgC, missing,
    });
    const parts = [`${backC.length} back clean`];
    if (rewashC.length) parts.push(`${rewashC.length} re-wash`);
    if (dmgC.length) parts.push(`${dmgC.length} damaged`);
    if (missing.length) parts.push(`${missing.length} missing`);
    addLog(d, actor, `Received ${batch.number}`, parts.join(', '), [...all, ...missing]);
    return batch;
  });
}

// ---------------------------------------------------- missing and retired ---
export async function markFound({ codes, as = 'soiled', loc = 'store' } = {}, actor) {
  return mutate((d) => {
    const list = codesOf(codes);
    if (!list.length) throw httpError(400, 'Scan the pieces that were found.');
    if (as === 'clean') checkLoc(d, loc);
    const at = nowIso();
    list.forEach((c) => {
      const p = pieceOr404(d, c);
      if (p.status !== 'missing') throw httpError(400, `${c} isn't missing — it's ${statusWord(p)}.`);
      setStatus(p, as === 'clean' ? 'clean' : 'soiled', at);
      if (as === 'clean') p.loc = loc;
      p.missingFrom = null;
    });
    addLog(d, actor, 'Found missing linen', `${list.length} piece(s), ${as === 'clean' ? 'clean into ' + locName(loc) : 'into the soiled bin'}`, list);
    return { ok: true };
  });
}

// Take pieces out of stock for good. Housekeeping can report damage and wear;
// writing off lost pieces or charging a guest needs the manage permission (the
// route checks that).
export async function retirePieces({ codes, reason, note = '' } = {}, actor) {
  return mutate((d) => {
    if (!RETIRE_REASONS[reason]) throw httpError(400, 'Choose why the pieces are leaving stock.');
    const list = codesOf(codes);
    if (!list.length) throw httpError(400, 'Scan the pieces first.');
    if ((reason === 'lost' || reason === 'charged')) {
      const notMissing = list.map((c) => pieceOr404(d, c)).find((p) => p.status !== 'missing');
      if (notMissing) throw httpError(400, `${notMissing.code} isn't missing. Only missing pieces can be written off as ${RETIRE_REASONS[reason].toLowerCase()}.`);
    }
    const at = nowIso();
    list.forEach((c) => {
      const p = pieceOr404(d, c);
      if (p.status === 'retired') throw httpError(400, `${c} is already out of stock.`);
      if (p.status === 'washing') throw httpError(400, `${c} is in a wash batch. Record it as damaged when the batch is received.`);
      retire(p, reason, String(note || '').trim(), at);
    });
    addLog(d, actor, RETIRE_REASONS[reason], `${list.length} piece(s)${note ? ' · ' + String(note).trim() : ''}`, list);
    return { ok: true };
  });
}

// --------------------------------------------------- storeroom & cupboards ---
export async function moveClean({ codes, to } = {}, actor) {
  return mutate((d) => {
    checkLoc(d, to);
    const list = codesOf(codes);
    if (!list.length) throw httpError(400, 'Choose the pieces to move.');
    list.forEach((c) => {
      const p = pieceOr404(d, c);
      if (p.status !== 'clean') throw httpError(400, `${c} is ${statusWord(p)}. Only clean linen can be moved.`);
      p.loc = to; p.statusAt = nowIso();
    });
    addLog(d, actor, `Moved to ${locName(to)}`, `${list.length} piece(s)`, list);
    return { ok: true };
  });
}

// Scan everything clean at one location. Pieces scanned here are put here
// (whatever the record said); pieces the record expected and nobody scanned
// become missing. A missing piece needs a note.
export async function stockCount({ loc, codes, note = '' } = {}, actor) {
  return mutate((d) => {
    checkLoc(d, loc);
    const seen = codesOf(codes);
    const expected = d.pieces.filter((p) => p.status === 'clean' && p.loc === loc);
    const notFound = expected.filter((p) => !seen.includes(p.code));
    if (notFound.length && !String(note).trim()) throw httpError(400, `${notFound.length} piece(s) weren't scanned. Add a note saying where you looked.`);
    const at = nowIso();
    const moved = [], found = [], corrected = [];
    seen.forEach((c) => {
      const p = pieceOr404(d, c);
      if (p.status === 'retired') throw httpError(400, `${c} was taken out of stock (${RETIRE_REASONS[p.retiredReason] || 'retired'}). Put it aside and tell the manager.`);
      if (p.status === 'clean' && p.loc === loc) return;
      if (p.status === 'clean') moved.push(c);
      else if (p.status === 'missing') found.push(c);
      else corrected.push(`${c} (was ${statusWord(p)})`);
      if (p.batchId) p.batchId = null;
      setStatus(p, 'clean', at); p.loc = loc; p.missingFrom = null;
    });
    notFound.forEach((p) => { setStatus(p, 'missing', at); p.missingFrom = `Not found in ${locName(loc)} count`; });
    const parts = [`${seen.length} counted`];
    if (moved.length) parts.push(`${moved.length} moved here`);
    if (found.length) parts.push(`${found.length} found`);
    if (corrected.length) parts.push(`corrected ${corrected.join(', ')}`);
    if (notFound.length) parts.push(`${notFound.length} missing`);
    if (String(note).trim()) parts.push(String(note).trim());
    addLog(d, actor, `Counted ${locName(loc)}`, parts.join(' · '), [...seen, ...notFound.map((p) => p.code)]);
    return { counted: seen.length, moved: moved.length, found: found.length, corrected: corrected.length, missing: notFound.map((p) => p.code) };
  });
}

export async function pieceHistory(code) {
  const d = await getLinen();
  const c = String(code || '').trim().toUpperCase();
  const p = d.pieces.find((x) => x.code === c);
  if (!p) throw httpError(404, `No piece with code ${c}.`);
  return { piece: p, history: d.log.filter((l) => (l.codes || []).includes(c)).slice(-100).reverse() };
}

// --------------------------------------------------------------- internals ---
function placesOf(r) {
  const places = r.beds.map((b) => ({ changedAt: b.changedAt }));
  if (Object.keys(r.towels || {}).length) places.push({ changedAt: r.towelsChangedAt });
  return places;
}
function bedLabel(d, room, bedId) {
  const r = d.rooms.find((x) => x.name === room);
  const b = r && r.beds.find((x) => x.id === bedId);
  return b ? b.label : '';
}
function setStatus(p, status, at) {
  p.status = status; p.statusAt = at;
  if (status !== 'in_use') { p.room = null; p.bed = null; }
  if (status !== 'clean') p.loc = null;
  if (status !== 'washing') p.batchId = null;
  if (status !== 'missing') p.missingFrom = null;
}
function retire(p, reason, note, at) {
  setStatus(p, 'retired', at);
  p.retiredReason = reason; p.note = note || '';
}
function statusWord(p) {
  return {
    clean: `clean in ${locName(p.loc)}`, in_use: `in use in ${p.room}`, soiled: 'in the soiled bin',
    washing: 'in the wash', missing: 'missing', retired: 'out of stock',
  }[p.status] || p.status;
}
function locName(loc) { return loc === 'store' ? 'the storeroom' : `the ${loc} cupboard`; }
function checkLoc(d, loc) {
  if (loc === 'store') return;
  const r = d.rooms.find((x) => x.name === loc);
  if (!r || !r.cupboard) throw httpError(400, 'Choose the storeroom or a room with a cupboard.');
}
function pieceOr404(d, code) {
  const p = d.pieces.find((x) => x.code === code);
  if (!p) throw httpError(404, `No piece with code ${code}.`);
  return p;
}
function codesOf(list) {
  return [...new Set((Array.isArray(list) ? list : []).map((c) => String(c || '').trim().toUpperCase()).filter(Boolean))];
}
function cleanSet(set, typeIds) {
  const out = {};
  Object.entries(set || {}).forEach(([k, v]) => { const n = clampInt(v, 0, 20, 0); if (n && typeIds.has(k)) out[k] = n; });
  return out;
}
function slugId(name, types) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16) || 'item';
  let id = base, i = 2;
  while (types.some((t) => t.id === id)) id = base + i++;
  return id;
}
function addLog(d, actor, action, detail, codes = []) {
  d.log.push({ id: newId('ll'), at: nowIso(), by: actorName(actor), role: actor?.role || 'system', action, detail, codes });
  if (d.log.length > LOG_CAP) d.log.splice(0, d.log.length - LOG_CAP);
}
function actorName(actor) { return actor?.name || 'system'; }
function clampInt(v, min, max, def) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}
function nowIso() { return new Date().toISOString(); }
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
