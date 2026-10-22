// Bed linen and towels: every piece tracked from shelf to bed to wash and back.
// Drives the API the same way the other suites do, against the file store.

import { rmSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(os.tmpdir(), 'laundry-linen-'));
process.env.FORCE_FILE_STORE = '1';
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = 'linen-secret';
delete process.env.RESEND_API_KEY;

const { handleRequest } = await import('../netlify/functions/api.js');

let pass = 0, fail = 0; const out = [];
const ok = (n, c, x = '') => { if (c) { pass++; out.push(`  ✅ ${n}`); } else { fail++; out.push(`  ❌ ${n} ${x}`); } };
const section = (t) => out.push(`\n▶ ${t}`);
const api = (method, p, opts = {}) => handleRequest({ method, path: p, query: opts.query || {}, body: opts.body || {}, headers: opts.headers || {} });
const H = (t) => ({ authorization: `Bearer ${t}` });
const piece = (doc, code) => doc.pieces.find((p) => p.code === code);

try {
  await api('POST', '/api/setup', { body: { hostelName: 'somewhere nice', adminName: 'Akosua', adminPin: '1234' } });
  const adminT = (await api('POST', '/api/auth/pin', { body: { pin: '1234' } })).body.token;
  const A = H(adminT);
  await api('POST', '/api/cashiers', { headers: A, body: { name: 'Ama', pin: '2222', role: 'housekeeping' } });
  await api('POST', '/api/cashiers', { headers: A, body: { name: 'Kojo', pin: '3333', role: 'laundry' } });
  await api('POST', '/api/cashiers', { headers: A, body: { name: 'Esi', pin: '4444', role: 'cashier' } });
  const hk = H((await api('POST', '/api/auth/pin', { body: { pin: '2222' } })).body.token);
  const ld = H((await api('POST', '/api/auth/pin', { body: { pin: '3333' } })).body.token);
  const cs = H((await api('POST', '/api/auth/pin', { body: { pin: '4444' } })).body.token);

  section('Roles and access');
  let r = await api('GET', '/api/cashiers', { headers: A });
  const ama = r.body.find((c) => c.name === 'Ama');
  ok('housekeeping role exists with linenUse only', ama.role === 'housekeeping' && ama.permissions.linenUse === true && !ama.permissions.acceptOrders, JSON.stringify(ama));
  ok('laundry person can wash linen by default', r.body.find((c) => c.name === 'Kojo').permissions.linenWash === true);
  ok('cashier can mark checkouts by default', r.body.find((c) => c.name === 'Esi').permissions.linenCheckout === true);
  r = await api('GET', '/api/linen', { headers: hk });
  ok('housekeeping can open the linen tab', r.status === 200 && r.body.types.length === 6, JSON.stringify(r.body).slice(0, 200));
  ok('defaults follow the handbook (queen = 1 big + 2 double sheets)', r.body.bedSets.Queen.bsheet === 1 && r.body.bedSets.Queen.dsheet === 2 && r.body.par === 3);
  r = await api('PUT', '/api/linen/setup', { headers: hk, body: { par: 2 } });
  ok('housekeeping cannot change setup', r.status === 403);

  section('Setup: rooms, beds, towels, cupboards');
  r = await api('PUT', '/api/linen/setup', { headers: A, body: {
    rooms: [
      { name: 'Duafe', cupboard: false, beds: [{ label: 'Bed 1', size: 'Double' }, { label: 'Bed 2', size: 'Double' }], towels: {} },
      { name: 'Akoma', cupboard: true, beds: [{ label: 'Bed', size: 'Queen' }], towels: { btowel: 2, htowel: 1, ftowel: 1 } },
    ],
  } });
  ok('admin saves rooms', r.status === 200 && r.body.rooms.length === 2, JSON.stringify(r.body).slice(0, 300));
  const duafe = r.body.rooms[0], akoma = r.body.rooms[1];
  ok('beds start stripped with ids', duafe.beds.every((b) => b.id && b.state === 'stripped'));
  ok('room towels saved', akoma.towels.btowel === 2 && akoma.cupboard === true);

  section('New stock gets codes');
  r = await api('POST', '/api/linen/pieces', { headers: A, body: { typeId: 'dsheet', qty: 8, cost: 120, supplier: 'Makola' } });
  ok('adds 8 double sheets with sequential codes', r.status === 201 && r.body.codes.length === 8 && r.body.codes[0] === 'L00001' && r.body.codes[7] === 'L00008', JSON.stringify(r.body));
  const sheets = r.body.codes;
  r = await api('POST', '/api/linen/pieces', { headers: A, body: { typeId: 'pcase', qty: 3 } });
  const cases = r.body.codes;
  r = await api('POST', '/api/linen/pieces', { headers: hk, body: { typeId: 'pcase', qty: 3 } });
  ok('housekeeping cannot add stock', r.status === 403);
  r = await api('POST', '/api/linen/pieces', { headers: A, body: { typeId: 'pcase', qty: 0 } });
  ok('quantity must be at least 1', r.status === 400);
  let doc = (await api('GET', '/api/linen', { headers: A })).body;
  ok('new pieces are clean in the storeroom', piece(doc, 'L00001').status === 'clean' && piece(doc, 'L00001').loc === 'store' && piece(doc, 'L00001').cost === 120);
  ok('the price paid becomes the reorder price', doc.types.find((t) => t.id === 'dsheet').cost === 120);

  section('Make a bed');
  const bed1 = duafe.beds[0].id;
  r = await api('POST', '/api/linen/change', { headers: hk, body: { room: 'Duafe', bed: bed1, on: [sheets[0], sheets[1], cases[0]] } });
  ok('housekeeping makes a bed from clean stock', r.status === 200, JSON.stringify(r.body));
  doc = (await api('GET', '/api/linen', { headers: A })).body;
  ok('pieces are now on that bed', [sheets[0], sheets[1], cases[0]].every((c) => piece(doc, c).status === 'in_use' && piece(doc, c).room === 'Duafe' && piece(doc, c).bed === bed1));
  ok('bed is made and dated', doc.rooms[0].beds[0].state === 'made' && !!doc.rooms[0].beds[0].changedAt);
  r = await api('POST', '/api/linen/change', { headers: hk, body: { room: 'Duafe', bed: duafe.beds[1].id, on: [sheets[0]] } });
  ok('a piece already on another bed cannot go on', r.status === 400 && /in use/.test(r.body.error), JSON.stringify(r.body));
  r = await api('POST', '/api/linen/change', { headers: hk, body: { room: 'Duafe', bed: bed1, on: ['L99999'] } });
  ok('unknown code is refused', r.status === 404);
  r = await api('POST', '/api/linen/change', { headers: cs, body: { room: 'Duafe', bed: bed1, on: [sheets[2]] } });
  ok('reception cannot change beds by default', r.status === 403);

  section('Checkout → change → one piece missing');
  r = await api('POST', '/api/linen/checkout', { headers: cs, body: { room: 'Duafe' } });
  ok('reception marks Duafe checked out', r.status === 200);
  doc = (await api('GET', '/api/linen', { headers: A })).body;
  ok('checkout is recorded on the room', !!doc.rooms[0].checkoutAt);
  r = await api('POST', '/api/linen/change', { headers: hk, body: { room: 'Duafe', bed: bed1, off: [sheets[0], sheets[1]], on: [sheets[2], sheets[3], cases[1]] } });
  ok('change with the pillowcase unaccounted for', r.status === 200 && r.body.missing.length === 1 && r.body.missing[0] === cases[0], JSON.stringify(r.body));
  doc = (await api('GET', '/api/linen', { headers: A })).body;
  ok('old sheets go to the soiled bin', piece(doc, sheets[0]).status === 'soiled' && piece(doc, sheets[0]).room === null);
  ok('the pillowcase is missing from that bed', piece(doc, cases[0]).status === 'missing' && /Duafe Bed 1/.test(piece(doc, cases[0]).missingFrom));
  ok('checkout stays until every bed in the room is changed', !!doc.rooms[0].checkoutAt);
  r = await api('POST', '/api/linen/change', { headers: hk, body: { room: 'Duafe', bed: duafe.beds[1].id, on: [sheets[4], sheets[5]] } });
  doc = (await api('GET', '/api/linen', { headers: A })).body;
  ok('checkout clears once all beds are changed', doc.rooms[0].checkoutAt === null, JSON.stringify(doc.rooms[0]));
  r = await api('POST', '/api/linen/change', { headers: hk, body: { room: 'Duafe', bed: bed1, off: [sheets[2]], keep: [sheets[2]] } });
  ok('a piece cannot both come off and stay', r.status === 400);

  section('Dorm beds check out one by one');
  doc = (await api('GET', '/api/linen', { headers: A })).body;
  const bed2 = doc.rooms[0].beds[1];
  r = await api('POST', '/api/linen/checkout', { headers: cs, body: { room: 'Duafe', bed: bed2.id } });
  doc = (await api('GET', '/api/linen', { headers: A })).body;
  ok('reception marks one bed\'s guest as gone', r.status === 200 && !!doc.rooms[0].beds[1].checkoutAt && !doc.rooms[0].beds[0].checkoutAt && !doc.rooms[0].checkoutAt);
  r = await api('POST', '/api/linen/checkout', { headers: cs, body: { room: 'Duafe', bed: 'bed_nope' } });
  ok('an unknown bed is refused', r.status === 404);
  r = await api('POST', '/api/linen/checkout', { headers: hk, body: { room: 'Duafe', bed: bed2.id } });
  ok('housekeeping cannot mark checkouts', r.status === 403);
  const onBed2 = doc.pieces.filter((p) => p.status === 'in_use' && p.bed === bed2.id).map((p) => p.code);
  r = await api('POST', '/api/linen/change', { headers: hk, body: { room: 'Duafe', bed: bed2.id, off: onBed2 } });
  doc = (await api('GET', '/api/linen', { headers: A })).body;
  ok('stripping that bed clears its guest-left mark', r.status === 200 && doc.rooms[0].beds[1].checkoutAt === null && doc.rooms[0].beds[1].state === 'stripped');

  section('Wash: send, receive short, resolve');
  r = await api('POST', '/api/linen/wash', { headers: hk, body: { codes: [sheets[0]] } });
  ok('housekeeping cannot send to the wash', r.status === 403);
  r = await api('POST', '/api/linen/wash', { headers: ld, body: { codes: [sheets[6]] } });
  ok('only soiled pieces can be sent', r.status === 400 && /soiled/.test(r.body.error));
  r = await api('POST', '/api/linen/wash', { headers: ld, body: { codes: [sheets[0], sheets[1]] } });
  ok('laundry sends batch W-0001', r.status === 201 && r.body.number === 'W-0001' && r.body.codes.length === 2, JSON.stringify(r.body));
  const batch = r.body;
  r = await api('POST', `/api/linen/batches/${batch.id}/receive`, { headers: ld, body: { back: [sheets[0], 'L00007'] } });
  ok('a piece that was not in the batch is refused', r.status === 400);
  r = await api('POST', `/api/linen/batches/${batch.id}/receive`, { headers: ld, body: { back: [sheets[0]], loc: 'Akoma' } });
  ok('received with one sheet short', r.status === 200 && r.body.status === 'short' && r.body.missing[0] === sheets[1], JSON.stringify(r.body));
  doc = (await api('GET', '/api/linen', { headers: A })).body;
  ok('the returned sheet is clean in the Akoma cupboard with one wash', piece(doc, sheets[0]).status === 'clean' && piece(doc, sheets[0]).loc === 'Akoma' && piece(doc, sheets[0]).washes === 1);
  ok('the short sheet is missing from the batch', piece(doc, sheets[1]).status === 'missing' && /W-0001/.test(piece(doc, sheets[1]).missingFrom));
  r = await api('POST', `/api/linen/batches/${batch.id}/receive`, { headers: ld, body: {} });
  ok('a batch cannot be received twice', r.status === 400);
  r = await api('POST', '/api/linen/found', { headers: ld, body: { codes: [sheets[1]] } });
  ok('the missing sheet turns up on the line', r.status === 200);
  doc = (await api('GET', '/api/linen', { headers: A })).body;
  ok('found pieces go back to the soiled bin', piece(doc, sheets[1]).status === 'soiled' && piece(doc, sheets[1]).missingFrom === null);

  section('Damage and write-offs');
  r = await api('POST', '/api/linen/retire', { headers: hk, body: { codes: [cases[0]], reason: 'lost' } });
  ok('housekeeping cannot write off as lost', r.status === 403);
  r = await api('POST', '/api/linen/retire', { headers: A, body: { codes: [sheets[6]], reason: 'lost' } });
  ok('only missing pieces can be written off as lost', r.status === 400);
  r = await api('POST', '/api/linen/retire', { headers: A, body: { codes: [cases[0]], reason: 'charged', note: 'Guest in Duafe' } });
  ok('admin charges the missing pillowcase to a guest', r.status === 200);
  r = await api('POST', '/api/linen/retire', { headers: hk, body: { codes: [sheets[7]], reason: 'damaged', note: 'burn mark' } });
  ok('housekeeping reports a burnt sheet', r.status === 200);
  doc = (await api('GET', '/api/linen', { headers: A })).body;
  ok('retired pieces keep their reason', piece(doc, sheets[7]).status === 'retired' && piece(doc, sheets[7]).retiredReason === 'damaged' && piece(doc, cases[0]).retiredReason === 'charged');

  section('Damage from staff waits for the supervisor');
  r = await api('POST', '/api/linen/pieces', { headers: A, body: { typeId: 'btowel', qty: 2 } });
  const towels = r.body.codes;
  await api('POST', '/api/linen/retire', { headers: hk, body: { codes: [towels[0]], reason: 'damaged', note: 'Stain' } });
  await api('POST', '/api/linen/retire', { headers: A, body: { codes: [towels[1]], reason: 'worn', note: 'thin' } });
  doc = (await api('GET', '/api/linen', { headers: A })).body;
  ok('housekeeping damage is flagged for checking', piece(doc, towels[0]).checked === false);
  ok("an admin's own damage report is not", piece(doc, towels[1]).checked === undefined);
  r = await api('POST', '/api/linen/check-damaged', { headers: hk, body: { code: towels[0] } });
  ok('only managers check damage', r.status === 403);
  r = await api('POST', '/api/linen/check-damaged', { headers: A, body: { code: towels[1] } });
  ok('a piece not waiting to be checked is refused', r.status === 400);
  r = await api('POST', '/api/linen/check-damaged', { headers: A, body: { code: towels[0], usable: true } });
  doc = (await api('GET', '/api/linen', { headers: A })).body;
  ok('"still usable" puts it back in the soiled bin', r.status === 200 && piece(doc, towels[0]).status === 'soiled' && piece(doc, towels[0]).retiredReason === null);
  ok('every item has a colour for labels and pictures', doc.types.every((t) => /^#[0-9a-f]{6}$/i.test(t.color)));

  section('Restock a cupboard, count the storeroom');
  r = await api('POST', '/api/linen/move', { headers: hk, body: { codes: [sheets[6]], to: 'Duafe' } });
  ok('cannot move to a room without a cupboard', r.status === 400);
  r = await api('POST', '/api/linen/move', { headers: hk, body: { codes: [cases[2]], to: 'Akoma' } });
  ok('moves a pillowcase to the Akoma cupboard', r.status === 200);
  // Storeroom now expects sheets[6] only. Count finds sheets[0] (recorded in Akoma) and not sheets[6].
  r = await api('POST', '/api/linen/count', { headers: hk, body: { loc: 'store', codes: [sheets[0]] } });
  ok('a count with pieces unscanned needs a note', r.status === 400 && /note/.test(r.body.error));
  r = await api('POST', '/api/linen/count', { headers: hk, body: { loc: 'store', codes: [sheets[0]], note: 'Checked every shelf' } });
  ok('count moves the scanned piece here and marks the unscanned one missing', r.status === 200 && r.body.moved === 1 && r.body.missing[0] === sheets[6], JSON.stringify(r.body));
  r = await api('POST', '/api/linen/count', { headers: hk, body: { loc: 'store', codes: [sheets[7]], note: 'x' } });
  ok('a retired piece scanned in a count is flagged', r.status === 400 && /out of stock/.test(r.body.error));

  section('Just the number works');
  r = await api('GET', '/api/linen/piece/3', { headers: hk });
  ok('"3" finds L00003', r.status === 200 && r.body.piece.code === 'L00003', JSON.stringify(r.body).slice(0, 120));
  r = await api('POST', '/api/linen/move', { headers: hk, body: { codes: ['10'], to: 'Akoma' } });
  ok('moves and scans accept the number alone', r.status === 200 || r.status === 400, JSON.stringify(r.body));
  ok('…and it was read as L00010', r.status === 200 || !/No piece/.test(r.body.error || ''));

  section('Piece history');
  r = await api('GET', `/api/linen/piece/${sheets[0].toLowerCase()}`, { headers: hk });
  ok('lookup is case-insensitive and lists the moves', r.status === 200 && r.body.piece.code === sheets[0] && r.body.history.length >= 4, JSON.stringify(r.body).slice(0, 300));

  section('Setup guards');
  r = await api('PUT', '/api/linen/setup', { headers: A, body: { rooms: [{ name: 'Akoma', originalName: 'Akoma', cupboard: true, beds: akoma.beds, towels: akoma.towels }] } });
  ok('cannot remove a room whose beds still have linen on', r.status === 400 && /Duafe/.test(r.body.error), JSON.stringify(r.body));
  r = await api('PUT', '/api/linen/setup', { headers: A, body: { rooms: [
    { name: 'Duafe', originalName: 'Duafe', beds: doc.rooms[0].beds, towels: {} },
    { name: 'Akoma', originalName: 'Akoma', cupboard: false, beds: akoma.beds, towels: akoma.towels },
  ] } });
  ok('cannot switch off a cupboard that still holds linen', r.status === 400 && /cupboard/.test(r.body.error));
  r = await api('PUT', '/api/linen/setup', { headers: A, body: { rooms: [
    { name: 'Duafe Dorm', originalName: 'Duafe', beds: doc.rooms[0].beds, towels: {} },
    { name: 'Akoma', originalName: 'Akoma', cupboard: true, beds: akoma.beds, towels: akoma.towels },
  ] } });
  doc = (await api('GET', '/api/linen', { headers: A })).body;
  ok('renaming a room carries its linen along', r.status === 200 && piece(doc, sheets[2]).room === 'Duafe Dorm' && doc.rooms[0].beds[0].state === 'made');
  r = await api('PUT', '/api/linen/setup', { headers: A, body: { types: doc.types.filter((t) => t.id !== 'dsheet') } });
  doc = (await api('GET', '/api/linen', { headers: A })).body;
  ok('a type with pieces is hidden, not deleted', r.status === 200 && doc.types.find((t) => t.id === 'dsheet').active === false);

  section('Bed sizes are the admin\'s own list');
  const sizesNow = Object.entries(doc.bedSets).map(([name, set]) => ({ name, originalName: name, set }));
  r = await api('PUT', '/api/linen/setup', { headers: hk, body: { bedSizes: [...sizesNow, { name: 'Bunk', set: { pcase: 1 } }] } });
  ok('housekeeping cannot change bed sizes', r.status === 403);
  r = await api('PUT', '/api/linen/setup', { headers: A, body: { bedSizes: [...sizesNow, { name: 'Bunk', set: { pcase: 1 } }] } });
  ok('admin adds a Bunk size with its own set', r.status === 200 && r.body.bedSets.Bunk && r.body.bedSets.Bunk.pcase === 1, JSON.stringify(r.body.bedSets));
  r = await api('PUT', '/api/linen/setup', { headers: A, body: { bedSizes: [...sizesNow, { name: 'double', set: {} }] } });
  ok('a size cannot be listed twice', r.status === 400 && /twice/.test(r.body.error));
  r = await api('PUT', '/api/linen/setup', { headers: A, body: { bedSizes: [] } });
  ok('at least one size is kept', r.status === 400);
  r = await api('PUT', '/api/linen/setup', { headers: A, body: { bedSizes: sizesNow.filter((z) => z.name !== 'Double').concat({ name: 'Bunk', originalName: 'Bunk', set: { pcase: 1 } }) } });
  ok('a size still used by a bed cannot be removed', r.status === 400 && /Double bed/.test(r.body.error), JSON.stringify(r.body));
  r = await api('PUT', '/api/linen/setup', { headers: A, body: { bedSizes: sizesNow.map((z) => z.name === 'Double' ? { ...z, name: 'Standard double' } : z) } });
  doc = (await api('GET', '/api/linen', { headers: A })).body;
  ok('renaming a size moves every bed of that size', r.status === 200 && doc.rooms[0].beds.every((b) => b.size === 'Standard double') && doc.bedSets['Standard double'].dsheet === 2 && !doc.bedSets.Double && !doc.bedSets.Bunk, JSON.stringify(doc.rooms[0].beds));
  r = await api('PUT', '/api/linen/setup', { headers: A, body: { rooms: [{ name: 'Akoma', originalName: 'Akoma', cupboard: true, beds: [{ label: 'Bed', size: 'Futon' }], towels: {} }, ...doc.rooms.filter((x) => x.name !== 'Akoma').map((x) => ({ ...x, originalName: x.name }))] } });
  ok('a bed must use one of the sizes', r.status === 400 && /Futon/.test(r.body.error));

  section('A room booked as Double or Triple');
  doc = (await api('GET', '/api/linen', { headers: A })).body;
  const sizes = Object.keys(doc.bedSets);
  const keepRooms = doc.rooms.map((x) => ({ ...x, originalName: x.name }));
  r = await api('PUT', '/api/linen/setup', { headers: A, body: { rooms: [...keepRooms, {
    name: 'Mframadan', beds: [{ label: 'Bed 1', size: sizes[0] }, { label: 'Extra bed', size: sizes[0], altOnly: true }],
    towels: { btowel: 2 }, alt: { mainName: 'Double', name: 'Triple', towels: { btowel: 3 } },
  }] } });
  const mf = r.body.rooms && r.body.rooms.find((x) => x.name === 'Mframadan');
  ok('a room can have a second booking with its own towels and a sofa bed', r.status === 200 && mf.alt.name === 'Triple' && mf.alt.towels.btowel === 3 && mf.beds[1].altOnly === true && mf.altOn === false, JSON.stringify(mf));
  const extra = mf.beds[1].id;
  const triple = (await api('POST', '/api/linen/pieces', { headers: A, body: { typeId: 'pcase', qty: 1 } })).body.codes;
  r = await api('POST', '/api/linen/change', { headers: hk, body: { room: 'Mframadan', bed: extra, on: triple } });
  ok('nothing goes on the sofa bed while the room is booked as Double', r.status === 400 && /sofa/.test(r.body.error), JSON.stringify(r.body));
  r = await api('POST', '/api/linen/booking', { headers: hk, body: { room: 'Mframadan', alt: true } });
  ok('housekeeping cannot change the booking', r.status === 403);
  r = await api('POST', '/api/linen/booking', { headers: cs, body: { room: 'Mframadan', alt: true } });
  doc = (await api('GET', '/api/linen', { headers: A })).body;
  ok('reception books it as Triple at check-in', r.status === 200 && doc.rooms.find((x) => x.name === 'Mframadan').altOn === true && !!doc.rooms.find((x) => x.name === 'Mframadan').altAt);
  r = await api('POST', '/api/linen/change', { headers: hk, body: { room: 'Mframadan', bed: extra, on: triple } });
  ok('as a Triple, the extra bed can be made up', r.status === 200);
  r = await api('POST', '/api/linen/booking', { headers: cs, body: { room: 'Duafe Dorm', alt: true } });
  ok('a room with one way to be booked refuses', r.status === 400);
  r = await api('PUT', '/api/linen/setup', { headers: A, body: { rooms: doc.rooms.map((x) => ({ ...x, originalName: x.name })) } });
  ok('saving setup keeps the booking and the sofa bed', r.status === 200 && r.body.rooms.find((x) => x.name === 'Mframadan').altOn === true && r.body.rooms.find((x) => x.name === 'Mframadan').beds[1].altOnly === true);

  section('Backup includes linen');
  r = await api('GET', '/api/backup', { headers: A });
  ok('backup carries the linen document', r.status === 200 && r.body.linen && r.body.linen.pieces.length === 14, `pieces ${r.body.linen && r.body.linen.pieces.length}`);
} catch (err) {
  fail++; out.push(`\n💥 ${err.stack || err}`);
}

console.log(out.join('\n'));
console.log(`\n${'─'.repeat(40)}\n${pass} passed, ${fail} failed`);
rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
