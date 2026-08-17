// Core business logic. Pure-ish functions over the storage layer so they can be
// unit-tested directly without HTTP.

import { readJSON, writeJSON, getCollection, saveCollection } from './store.js';
import {
  hashPin, verifyPin, signToken, defaultCashierPermissions, defaultLaundryPermissions, newId, can,
} from './auth.js';

const ROLES = ['admin', 'cashier', 'laundry'];
function normalizeRole(r) { return ROLES.includes(r) ? r : 'cashier'; }
function defaultPermsFor(role) {
  return role === 'admin' ? {} : role === 'laundry' ? defaultLaundryPermissions() : defaultCashierPermissions();
}
import { sendEmail, orderEmail, inviteEmail } from './email.js';
import { sendPushToAll } from './push.js';

const K_SETTINGS = 'settings';
const K_CASHIERS = 'cashiers';
const K_ORDERS = 'orders';
const K_META = 'meta';
const K_SHIFTS = 'shifts';
const K_DISCOUNTS = 'discounts';

export const STATUSES = ['new', 'accepted', 'cleaning', 'ready', 'completed', 'cancelled'];
const FLOW = { accepted: 'cleaning', cleaning: 'ready', ready: 'completed' };
const REVERSE = { completed: 'ready', ready: 'cleaning', cleaning: 'accepted' };

// Which staff-attribution field records each stage transition.
const STAGE_ACTOR_FIELD = { accepted: 'acceptedBy', cleaning: 'cleaningBy', ready: 'readyBy', completed: 'completedBy' };

// The site URL to use in emails: the admin-set Base URL, else Netlify's own URL.
export function effectiveBaseUrl(settings) {
  const url = settings.baseUrl || process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL || '';
  return url.replace(/\/$/, '');
}

// Reception shift windows (local time). AM 06:00–13:59, PM 14:00–21:59, Night 22:00–05:59.
export function shiftOf(date) {
  const h = new Date(date).getHours();
  if (h >= 6 && h < 14) return 'AM';
  if (h >= 14 && h < 22) return 'PM';
  return 'Night';
}

// ---------------------------------------------------------------- Settings ---
export function defaultSettings() {
  return {
    hostelName: 'somewhere nice',
    logoDataUrl: '',
    accentColor: '#0f766e',
    hoverColor: '#FFF8ED',
    currency: { code: 'GHS', symbol: '₵' },
    rooms: [], // admin-defined room names cashiers pick from
    pricePerLoad: 10,
    piecesPerLoad: 25,
    turnaroundHours: 24,
    requireEmail: true, // guest must give an email when ordering
    requireRoomOnAccept: true, // reception must set a room when accepting
    followUpHours: 1, // accepted orders older than this need follow-up
    followUpEveryHours: 1, // repeat the email/push reminder this often
    pickupLeadHours: 3, // start "prepare for pickup" reminders this many hours before pickup
    readyStuckHours: 12, // email if an order sits at "ready" longer than this
    readyAlertUserIds: [], // staff (besides admin) who also get the ready-stuck email
    quietFrom: 18, // no reminders from 18:00 (6 PM) …
    quietTo: 7, // … until 07:00 (7 AM) next day
    adminEmail: '',
    receptionEmail: '',
    alertRecipients: [], // extra emails alerted when an order is stuck
    baseUrl: '',
    configured: false,
  };
}

// Parse room names from an array or a newline/comma separated string.
export function normalizeRooms(input) {
  const arr = Array.isArray(input) ? input : String(input || '').split(/[\n,]+/);
  return [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))].slice(0, 300);
}

// Parse a list of emails from an array or a comma/space/newline separated string.
export function normalizeEmails(input) {
  const arr = Array.isArray(input) ? input : String(input || '').split(/[\s,;]+/);
  return [...new Set(arr.map((s) => String(s).trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];
}

export async function getSettings() {
  const s = await readJSON(K_SETTINGS, null);
  return { ...defaultSettings(), ...(s || {}) };
}

export async function updateSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  // Never let piecesPerLoad drop below 1.
  next.piecesPerLoad = Math.max(1, Number(next.piecesPerLoad) || 25);
  next.pricePerLoad = Math.max(0, Number(next.pricePerLoad) || 0);
  next.turnaroundHours = Math.max(1, Number(next.turnaroundHours) || 24);
  next.followUpHours = Math.max(0.25, Number(next.followUpHours) || 1);
  next.followUpEveryHours = Math.max(0.25, Number(next.followUpEveryHours) || 1);
  next.pickupLeadHours = Math.max(0, Number(next.pickupLeadHours) || 3);
  next.readyStuckHours = Math.max(0.25, Number(next.readyStuckHours) || 12);
  next.readyAlertUserIds = Array.isArray(next.readyAlertUserIds) ? [...new Set(next.readyAlertUserIds.map(String))] : [];
  next.quietFrom = clampHour(next.quietFrom, 18);
  next.quietTo = clampHour(next.quietTo, 7);
  next.rooms = normalizeRooms(next.rooms);
  next.requireEmail = !!next.requireEmail;
  next.requireRoomOnAccept = !!next.requireRoomOnAccept;
  next.alertRecipients = normalizeEmails(next.alertRecipients);
  await writeJSON(K_SETTINGS, next);
  return next;
}

// ------------------------------------------------------------------- Setup ---
export async function isSetup() {
  const cashiers = await getCollection(K_CASHIERS);
  return cashiers.some((c) => c.role === 'admin');
}

export async function firstRunSetup({ hostelName, adminName, adminPin }) {
  if (await isSetup()) throw httpError(409, 'Already set up');
  validatePin(adminPin);
  const { salt, hash } = hashPin(adminPin);
  const admin = {
    id: newId('csh'), name: adminName || 'Admin', role: 'admin',
    salt, hash, permissions: {}, active: true, createdAt: nowIso(),
  };
  await saveCollection(K_CASHIERS, [admin]);
  await updateSettings({ hostelName: hostelName || '', configured: true });
  return { ok: true };
}

// ---------------------------------------------------------------- Cashiers ---
export async function listCashiers() {
  const cashiers = await getCollection(K_CASHIERS);
  return cashiers.map(publicCashier);
}

export async function createCashier({ name, pin, role = 'cashier', permissions, email }) {
  validatePin(pin);
  const cashiers = await getCollection(K_CASHIERS);
  if (await pinInUse(pin, cashiers)) throw httpError(409, 'That PIN is already in use — choose another.');
  const { salt, hash } = hashPin(pin);
  const r = normalizeRole(role);
  const c = {
    id: newId('csh'), name: name || 'Staff',
    role: r,
    salt, hash,
    email: validEmail(email) ? String(email).trim().toLowerCase() : '',
    permissions: r === 'admin' ? {} : { ...defaultPermsFor(r), ...(permissions || {}) },
    active: true, createdAt: nowIso(),
  };
  cashiers.push(c);
  await saveCollection(K_CASHIERS, cashiers);
  return publicCashier(c);
}

// Send a branded invitation email. The admin supplies the cashier's current PIN so
// it can be included; we verify it matches before sending (PINs are stored hashed).
export async function inviteCashier(id, { email, pin }, actor) {
  const cashiers = await getCollection(K_CASHIERS);
  const c = cashiers.find((x) => x.id === id);
  if (!c) throw httpError(404, 'Cashier not found');
  if (!validEmail(email)) throw httpError(400, 'A valid email address is required.');
  if (!verifyPin(String(pin || ''), c.salt, c.hash)) {
    throw httpError(400, "That PIN doesn't match this person — enter their current PIN so it can be included in the invite.");
  }
  c.email = String(email).trim().toLowerCase();
  await saveCollection(K_CASHIERS, cashiers);
  const settings = await getSettings();
  const { subject, html } = inviteEmail(
    { name: c.name, role: c.role, permissions: c.role === 'admin' ? {} : c.permissions, pin: String(pin) },
    { ...settings, baseUrl: effectiveBaseUrl(settings) },
    { inviterName: actor?.name },
  );
  const res = await sendEmail({ to: c.email, subject, html });
  return { ok: true, sentTo: c.email, dryRun: !!res.dryRun };
}

export async function updateCashier(id, patch, actor) {
  const cashiers = await getCollection(K_CASHIERS);
  const c = cashiers.find((x) => x.id === id);
  if (!c) throw httpError(404, 'Cashier not found');
  if (patch.name != null) c.name = patch.name;
  if (patch.email != null) c.email = validEmail(patch.email) ? String(patch.email).trim().toLowerCase() : '';
  if (patch.role != null) {
    const nr = normalizeRole(patch.role);
    if (nr !== c.role) { c.role = nr; c.permissions = nr === 'admin' ? {} : { ...defaultPermsFor(nr) }; }
  }
  if (patch.active != null) c.active = !!patch.active;
  if (patch.permissions && c.role !== 'admin') c.permissions = { ...c.permissions, ...patch.permissions };
  if (patch.pin) {
    validatePin(patch.pin);
    if (await pinInUse(patch.pin, cashiers, id)) throw httpError(409, 'That PIN is already in use.');
    const { salt, hash } = hashPin(patch.pin);
    c.salt = salt; c.hash = hash;
  }
  // Never allow removing the last admin.
  if (c.role !== 'admin' && cashiers.filter((x) => x.role === 'admin' && x.active).length === 0) {
    throw httpError(400, 'At least one active admin is required.');
  }
  await saveCollection(K_CASHIERS, cashiers);
  return publicCashier(c);
}

export async function deleteCashier(id) {
  const cashiers = await getCollection(K_CASHIERS);
  const c = cashiers.find((x) => x.id === id);
  if (!c) throw httpError(404, 'Cashier not found');
  const remainingAdmins = cashiers.filter((x) => x.role === 'admin' && x.id !== id).length;
  if (c.role === 'admin' && remainingAdmins === 0) throw httpError(400, 'Cannot remove the last admin.');
  await saveCollection(K_CASHIERS, cashiers.filter((x) => x.id !== id));
  return { ok: true };
}

export async function authenticatePin(pin) {
  const cashiers = await getCollection(K_CASHIERS);
  const c = cashiers.find((x) => x.active && verifyPin(String(pin), x.salt, x.hash));
  if (!c) return null;
  const user = publicCashier(c);
  const token = signToken({ id: c.id, name: c.name, role: c.role });
  return { user, token };
}

export async function getCashierById(id) {
  const cashiers = await getCollection(K_CASHIERS);
  const c = cashiers.find((x) => x.id === id);
  return c ? publicCashier(c) : null;
}

// -------------------------------------------------------------------- Orders --
export function computeLoads(items, piecesPerLoad) {
  const n = Math.max(0, Math.floor(Number(items) || 0));
  return Math.max(items > 0 ? 1 : 0, Math.ceil(n / Math.max(1, piecesPerLoad)));
}

export async function createOrder({ guestName, guestEmail, items, note, paymentTiming, paymentMethod }) {
  const settings = await getSettings();
  if (!guestName || !String(guestName).trim()) throw httpError(400, 'Name is required');
  const emailStr = String(guestEmail || '').trim().toLowerCase();
  if (settings.requireEmail && !emailStr) throw httpError(400, 'An email address is required');
  if (emailStr && !validEmail(emailStr)) throw httpError(400, 'Please enter a valid email address');
  const n = Math.floor(Number(items));
  if (!n || n < 1) throw httpError(400, 'Number of items must be at least 1');

  // Payment preference chosen by the guest at order time (form enforces the choice;
  // default to pay-at-pickup and cash if somehow omitted).
  const timing = paymentTiming === 'now' ? 'now' : 'pickup';
  const method = timing === 'now' ? (paymentMethod === 'card' ? 'card' : 'cash') : null;
  const orders = await getCollection(K_ORDERS);
  const number = await nextOrderNumber();
  const loads = computeLoads(n, settings.piecesPerLoad);

  const order = {
    id: newId('ord'),
    publicId: newId('pub'),
    number,
    guestName: String(guestName).trim(),
    guestEmail: emailStr,
    items: n,
    loads,
    status: 'new',
    room: '',
    pickupAt: null,
    price: null,
    paymentTiming: timing, // 'now' | 'pickup'  (guest's choice)
    paymentMethod: method, // 'cash' | 'card' | null (guest's choice when paying now)
    paymentStatus: 'unpaid', // unpaid | partial | paid
    amountPaid: 0,
    payments: [], // ledger: { id, amount, method, at, by, shiftId }
    paidBy: null,
    paidAt: null,
    paidShiftId: null,
    // staff attribution, filled as the order progresses
    acceptedBy: null,
    cleaningBy: null,
    readyBy: null,
    completedBy: null,
    delayReason: '',
    delayReasonAt: null,
    lastFollowUpAt: null,
    note: note ? String(note).slice(0, 500) : '',
    messages: [],
    logs: [],
    createdAt: nowIso(),
    acceptedAt: null,
    updatedAt: nowIso(),
  };
  addLog(order, { name: order.guestName, role: 'guest' }, 'placed',
    `Placed ${n} item(s) · ${timing === 'now' ? 'pay now (' + method + ')' : 'pay at pickup'}`);
  orders.push(order);
  await saveCollection(K_ORDERS, orders);
  try { await sendPushToAll({ title: 'New laundry order', body: `#${number} · ${order.guestName} · ${n} item(s)`, url: '/app', tag: 'order-' + number }); } catch {}
  return publicOrder(order);
}

export async function listOrders({ status, from, to } = {}) {
  const orders = await getCollection(K_ORDERS);
  let list = orders;
  if (status) list = list.filter((o) => o.status === status);
  if (from) list = list.filter((o) => new Date(o.createdAt) >= new Date(from));
  if (to) list = list.filter((o) => new Date(o.createdAt) <= new Date(to));
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(publicOrder);
}

export async function getOrder(id) {
  const orders = await getCollection(K_ORDERS);
  const o = orders.find((x) => x.id === id);
  return o ? publicOrder(o) : null;
}

export async function getOrderByPublicId(publicId) {
  const orders = await getCollection(K_ORDERS);
  const o = orders.find((x) => x.publicId === publicId);
  return o ? publicOrder(o) : null;
}

export async function acceptOrder(id, data, actor) {
  const settings = await getSettings();
  return mutateOrder(id, async (o) => {
    if (o.status !== 'new') throw httpError(409, `Order already ${o.status}`);
    const room = data.room ? String(data.room).trim() : '';
    if (settings.requireRoomOnAccept && !room) throw httpError(400, 'Please select a room.');
    o.status = 'accepted';
    o.acceptedAt = nowIso();
    o.acceptedBy = actorRef(actor);
    o.room = room || o.room;
    o.loads = computeLoads(o.items, settings.piecesPerLoad);
    const computed = o.loads * settings.pricePerLoad;
    let priceNote = '';
    if (data.price != null && data.price !== '') {
      const p = Math.max(0, Number(data.price));
      if (p !== computed) {
        const reason = String(data.priceReason || '').trim();
        if (!reason) throw httpError(400, 'Please give a reason for changing the price.');
        priceNote = ` · price changed from ${settings.currency.symbol}${computed} to ${settings.currency.symbol}${p} (reason: ${reason})`;
      }
      o.price = p;
    } else {
      o.price = computed;
    }
    o.listPrice = o.price;
    // Default pickup = 6:00 PM the following day, unless reception picked one.
    o.pickupAt = data.pickupAt || nextDaySixPM();
    // A discount code may be applied right at acceptance, before any payment.
    let discountNote = '';
    if (data.discountCode) {
      const applied = await applyDiscountToOrder(o, data.discountCode, actor);
      discountNote = ` · discount ${applied.code} −${applied.amount}`;
    }
    addLog(o, actor, 'accepted',
      `Accepted · room ${o.room || '—'} · ${settings.currency.symbol}${o.price} · ready by ${o.pickupAt}${priceNote}${discountNote}`);
    // Reception may collect payment right at acceptance (full, or a partial amount
    // if allowed).
    if (data.paymentStatus === 'paid' || (data.amountPaid != null && data.amountPaid !== '')) {
      const amt = (data.amountPaid != null && data.amountPaid !== '') ? Number(data.amountPaid) : o.price;
      if (amt < o.price - 0.001 && !canPartial(actor)) throw httpError(403, 'You are not allowed to record a partial payment.');
      await applyPayment(o, { amount: amt, method: data.paymentMethod }, actor);
    }
    await notifyGuest('accepted', o, settings);
    return o;
  });
}

export async function advanceStatus(id, target, actor) {
  const settings = await getSettings();
  return mutateOrder(id, async (o) => {
    if (o.status === 'completed') throw httpError(409, 'This order has already been picked up.');
    if (o.status === 'cancelled') throw httpError(409, 'This order was cancelled.');
    const expected = FLOW[o.status];
    if (!expected) throw httpError(409, `Cannot advance from ${o.status}`);
    if (target && target !== expected) throw httpError(400, `Next stage must be ${expected}`);
    // Laundry staff only run cleaning → ready; they can't mark an order picked up.
    if (expected === 'completed' && actor?.role === 'laundry') {
      throw httpError(403, 'Laundry staff cannot mark orders as picked up — reception handles that.');
    }
    // An order cannot be picked up (completed) before it has been paid.
    if (expected === 'completed' && o.paymentStatus !== 'paid') {
      throw httpError(409, 'Payment must be collected before the order can be marked picked up.');
    }
    o.status = expected;
    o.delayReasonAt = null; // moving on clears any delay snooze
    if (STAGE_ACTOR_FIELD[expected]) o[STAGE_ACTOR_FIELD[expected]] = actorRef(actor);
    if (expected === 'ready') { o.readyAt = nowIso(); o.readyAlertedAt = null; }
    if (expected === 'completed') o.completedAt = nowIso();
    addLog(o, actor, 'status', `Status → ${expected}`);
    if (['cleaning', 'ready', 'completed'].includes(expected)) {
      await notifyGuest(expected, o, settings);
    }
    return o;
  });
}

// Move an order one stage backwards (e.g. ready → cleaning). Permission-gated at API.
export async function revertStatus(id, actor, reason) {
  return mutateOrder(id, async (o) => {
    const prev = REVERSE[o.status];
    if (!prev) throw httpError(409, `Cannot move ${o.status} backwards`);
    const from = o.status;
    o.status = prev;
    if (from === 'completed') o.completedAt = null;
    addLog(o, actor, 'reverted', `Moved back ${from} → ${prev}${reason ? ' · ' + reason : ''}`);
    return o;
  });
}

function canPartial(actor) {
  return !!(actor && (actor.role === 'admin' || (actor.permissions && actor.permissions.partialPayment)));
}

// Record a payment (full or partial). Used at acceptance or later.
export async function recordPayment(id, data, actor) {
  const method = typeof data === 'string' ? data : (data && data.method);
  const amount = data && typeof data === 'object' ? data.amount : undefined;
  return mutateOrder(id, async (o) => {
    if (o.paymentStatus === 'paid') throw httpError(409, 'This order is already fully paid.');
    const price = Number(o.price) || 0;
    const remaining = round2(price - (Number(o.amountPaid) || 0));
    const amt = (amount == null || amount === '') ? remaining : round2(Number(amount));
    if (!(amt > 0)) throw httpError(400, 'Enter a payment amount greater than zero.');
    if (amt > remaining + 0.001) throw httpError(400, `That's more than the ${remaining} still owed.`);
    if (amt < remaining - 0.001 && !canPartial(actor)) {
      throw httpError(403, 'You are not allowed to record a partial payment — collect the full amount or ask an admin.');
    }
    await applyPayment(o, { amount: amt, method }, actor);
    return o;
  });
}

// Apply a payment amount to the order ledger and recompute the status.
async function applyPayment(o, { amount, method } = {}, actor) {
  const price = Number(o.price) || 0;
  o.amountPaid = Number(o.amountPaid) || 0;
  const remaining = round2(price - o.amountPaid);
  let amt = (amount == null || amount === '') ? remaining : round2(Number(amount));
  if (!(amt > 0)) return 0;
  if (amt > remaining + 0.001) amt = remaining; // never overpay
  const m = method === 'card' ? 'card' : 'cash';
  const shift = actor?.id ? await getOpenShiftFor(actor.id) : null;
  o.payments = o.payments || [];
  o.payments.push({ id: newId('pay'), amount: amt, method: m, at: nowIso(), by: actorRef(actor), shiftId: shift ? shift.id : null });
  o.amountPaid = round2(o.amountPaid + amt);
  o.paymentStatus = o.amountPaid >= price - 0.001 ? 'paid' : 'partial';
  o.paymentMethod = m;
  o.paidAt = nowIso();
  o.paidBy = actorRef(actor);
  o.paidShiftId = shift ? shift.id : null;
  const label = o.paymentStatus === 'paid' ? 'Payment' : 'Partial payment';
  addLog(o, actor, 'payment', `${label} · ${m} · ${amt}${o.paymentStatus === 'partial' ? ` (paid ${o.amountPaid} of ${price})` : ''}${shift ? ' · shift ' + shift.type : ''}`);
  return amt;
}

export async function modifyOrder(id, patch, actor) {
  const settings = await getSettings();
  return mutateOrder(id, async (o) => {
    const changes = [];
    const set = (field, val, label) => {
      if (val != null && String(val) !== String(o[field] ?? '')) {
        changes.push(`${label}: ${o[field] ?? '—'} → ${val}`);
        o[field] = val;
      }
    };
    if (patch.room != null) set('room', String(patch.room).trim(), 'room');
    if (patch.items != null) {
      const n = Math.max(1, Math.floor(Number(patch.items)));
      set('items', n, 'items');
      o.loads = computeLoads(o.items, settings.piecesPerLoad);
    }
    if (patch.price != null && patch.price !== '') {
      const np = Math.max(0, Number(patch.price));
      if (np !== Number(o.price)) {
        const reason = String(patch.priceReason || '').trim();
        if (!reason) throw httpError(400, 'Please give a reason for changing the price.');
        changes.push(`price: ${settings.currency.symbol}${o.price} → ${settings.currency.symbol}${np} (reason: ${reason})`);
        // An edited price becomes the new pre-discount price; any discount on the
        // order is then recalculated against it below.
        o.listPrice = np;
        o.price = np;
        if (o.discount) {
          const amount = discountAmountFor(np, o.discount);
          o.discount = { ...o.discount, amount };
          o.price = round2(np - amount);
          changes.push(`discount ${o.discount.code} recalculated: −${amount}`);
        }
        repriceStatus(o);
      }
    }
    // Discounts: apply/replace a code, or take one off.
    if (patch.removeDiscount) {
      const gone = await removeDiscountFromOrder(o, actor);
      if (gone) changes.push(`discount ${gone.code} removed`);
    } else if (patch.discountCode) {
      const applied = await applyDiscountToOrder(o, patch.discountCode, actor);
      changes.push(`discount ${applied.code} applied (−${applied.amount})`);
    }
    if (patch.pickupAt != null) set('pickupAt', patch.pickupAt, 'pickup');
    if (patch.paymentTiming != null) set('paymentTiming', patch.paymentTiming === 'now' ? 'now' : 'pickup', 'timing');
    if (patch.paymentStatus != null) {
      if (patch.paymentStatus === 'paid' && o.paymentStatus !== 'paid') {
        await applyPayment(o, { method: patch.paymentMethod }, actor); // pays the remainder
        changes.push('payment → paid');
      } else if (patch.paymentStatus === 'unpaid' && o.paymentStatus !== 'unpaid') {
        o.paymentStatus = 'unpaid'; o.amountPaid = 0; o.payments = []; o.paidAt = null; o.paidBy = null; o.paidShiftId = null;
        changes.push('payment reset → unpaid');
      }
    }
    // Admin can correct the recorded payment date.
    if (patch.paidAt != null && patch.paidAt !== '' && (Number(o.amountPaid) || 0) > 0) {
      const iso = new Date(patch.paidAt).toISOString();
      if (iso !== o.paidAt) {
        o.paidAt = iso;
        if (o.payments && o.payments.length) o.payments[o.payments.length - 1].at = iso;
        changes.push(`payment date → ${iso.slice(0, 10)}`);
      }
    }
    if (changes.length) addLog(o, actor, 'modified', changes.join(' · '));
    return o;
  });
}

// ------------------------------------------------- Admin: repair payment data --
// Three generations of this app recorded payments differently:
//   1. status only      — paymentStatus/paidAt/paidBy, no amount anywhere
//   2. amountPaid       — a total, but no per-payment ledger
//   3. payments[]       — the ledger used today
// Reporting reads all three, but only the ledger carries a method and a taker per
// payment, so shift and staff figures are coarser for the older shapes. This walks
// every order and brings it up to generation 3, inventing nothing: the amount comes
// from the order's own price, the time from paidAt, the taker from paidBy.
//
// Call with { apply: false } (the default) for a dry run that reports what would
// change. Running it twice is harmless — a repaired order no longer matches.
export async function backfillPaymentRecords({ apply = false } = {}, actor) {
  const orders = await getCollection(K_ORDERS);
  const repairs = [];
  for (const o of orders) {
    const paid = amountPaidOf(o);
    if (paid <= 0) continue;
    const ledger = (o.payments || []).filter((p) => (Number(p.amount) || 0) > 0);
    const ledgerTotal = round2(sum(ledger.map((p) => Number(p.amount) || 0)));
    const missingLedger = round2(paid - ledgerTotal);
    const missingAmount = round2(paid - (Number(o.amountPaid) || 0));
    if (missingLedger <= 0.001 && missingAmount <= 0.001) continue;

    const at = o.paidAt || o.acceptedAt || o.createdAt;
    repairs.push({
      number: o.number,
      guestName: o.guestName,
      amount: missingLedger > 0.001 ? missingLedger : 0,
      amountPaidWas: round2(Number(o.amountPaid) || 0),
      amountPaidNow: paid,
      method: o.paymentMethod === 'card' ? 'card' : 'cash',
      at,
      by: nameOf(o.paidBy) || null,
    });

    if (!apply) continue;
    if (missingAmount > 0.001) o.amountPaid = paid;
    if (missingLedger > 0.001) {
      o.payments = o.payments || [];
      o.payments.push({
        id: newId('pay'),
        amount: missingLedger,
        method: o.paymentMethod === 'card' ? 'card' : 'cash',
        at,
        by: o.paidBy || null,
        shiftId: o.paidShiftId || null,
        backfilled: true, // marks a reconstructed entry, not one recorded live
      });
    }
    o.updatedAt = nowIso();
    addLog(o, actor, 'payment', `Payment record repaired · ${o.paymentMethod === 'card' ? 'card' : 'cash'} · ${missingLedger > 0.001 ? missingLedger : paid}`);
  }
  if (apply && repairs.length) await saveCollection(K_ORDERS, orders);
  return {
    apply,
    scanned: orders.length,
    orders: repairs.length,
    amount: round2(sum(repairs.map((r) => r.amount))),
    repairs: repairs.sort((a, b) => a.number - b.number),
  };
}

// Admin-only bulk delete: permanently remove orders created within a date range.
export async function deleteOrdersInRange({ from, to } = {}) {
  const orders = await getCollection(K_ORDERS);
  const fromD = from ? new Date(from) : new Date(0);
  const toD = to ? new Date(to) : new Date(8640000000000000);
  const keep = orders.filter((o) => {
    const d = new Date(o.createdAt);
    return !(d >= fromD && d <= toD);
  });
  const removed = orders.length - keep.length;
  await saveCollection(K_ORDERS, keep);
  return { removed, remaining: keep.length };
}

export async function cancelOrder(id, actor, reason) {
  return mutateOrder(id, async (o) => {
    if (o.status === 'completed') throw httpError(409, 'Completed orders cannot be cancelled');
    o.status = 'cancelled';
    addLog(o, actor, 'cancelled', reason ? `Cancelled: ${reason}` : 'Cancelled');
    return o;
  });
}

// ----------------------------------------------------------------- Discounts --
// Admins issue named codes; reception applies one to an order. A code carries a
// percentage or a fixed amount off, and may be limited by an expiry date, a
// maximum number of uses, or simply switched off.

export async function listDiscounts() {
  const list = await getCollection(K_DISCOUNTS);
  return list.map(publicDiscount).sort((a, b) => a.code.localeCompare(b.code));
}

export async function createDiscount(data, actor) {
  const list = await getCollection(K_DISCOUNTS);
  const code = normalizeCode(data.code);
  if (!code) throw httpError(400, 'Give the discount a code, e.g. STAFF20.');
  if (list.some((d) => d.code === code)) throw httpError(409, `The code ${code} is already in use.`);
  const d = {
    id: newId('disc'),
    code,
    label: String(data.label || '').trim(),
    ...validatedDiscountValue(data),
    expiresAt: parseExpiry(data.expiresAt),
    maxUses: parseMaxUses(data.maxUses),
    active: data.active !== false,
    uses: 0,
    createdAt: nowIso(),
    createdBy: actorRef(actor),
  };
  list.push(d);
  await saveCollection(K_DISCOUNTS, list);
  return publicDiscount(d);
}

export async function updateDiscount(id, patch, actor) {
  const list = await getCollection(K_DISCOUNTS);
  const d = list.find((x) => x.id === id);
  if (!d) throw httpError(404, 'Discount not found');
  if (patch.code != null) {
    const code = normalizeCode(patch.code);
    if (!code) throw httpError(400, 'A discount needs a code.');
    if (list.some((x) => x.id !== id && x.code === code)) throw httpError(409, `The code ${code} is already in use.`);
    d.code = code;
  }
  if (patch.label != null) d.label = String(patch.label).trim();
  if (patch.type != null || patch.value != null) {
    Object.assign(d, validatedDiscountValue({ type: patch.type ?? d.type, value: patch.value ?? d.value }));
  }
  if (patch.expiresAt !== undefined) d.expiresAt = parseExpiry(patch.expiresAt);
  if (patch.maxUses !== undefined) d.maxUses = parseMaxUses(patch.maxUses);
  if (patch.active != null) d.active = !!patch.active;
  d.updatedAt = nowIso();
  d.updatedBy = actorRef(actor);
  await saveCollection(K_DISCOUNTS, list);
  return publicDiscount(d);
}

// Codes are kept even once spent, because orders reference them. Deleting one
// leaves the discount already recorded on an order untouched.
export async function deleteDiscount(id) {
  const list = await getCollection(K_DISCOUNTS);
  if (!list.some((x) => x.id === id)) throw httpError(404, 'Discount not found');
  await saveCollection(K_DISCOUNTS, list.filter((x) => x.id !== id));
  return { ok: true };
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}
function validatedDiscountValue({ type, value }) {
  const t = type === 'fixed' ? 'fixed' : 'percent';
  const v = round2(Number(value));
  if (!(v > 0)) throw httpError(400, 'A discount needs a value greater than zero.');
  if (t === 'percent' && v > 100) throw httpError(400, 'A percentage discount cannot exceed 100%.');
  return { type: t, value: v };
}
function parseExpiry(v) {
  if (v == null || v === '') return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59.999` : v);
  if (isNaN(d)) throw httpError(400, 'That expiry date is not a valid date.');
  return d.toISOString();
}
function parseMaxUses(v) {
  if (v == null || v === '') return null;
  const n = Math.floor(Number(v));
  if (!(n > 0)) throw httpError(400, 'Maximum uses must be a whole number greater than zero.');
  return n;
}
function publicDiscount(d) {
  return { ...d, spent: d.maxUses != null && d.uses >= d.maxUses, expired: isExpired(d) };
}
function isExpired(d) {
  return !!(d.expiresAt && new Date(d.expiresAt) < new Date());
}

// How much a code takes off a given price, never more than the price itself.
export function discountAmountFor(listPrice, d) {
  const base = Number(listPrice) || 0;
  const off = d.type === 'fixed' ? Number(d.value) || 0 : base * (Number(d.value) || 0) / 100;
  return round2(Math.min(base, Math.max(0, off)));
}

// The price before any discount. Orders predating discounts only have `price`.
function listPriceOf(o) {
  return round2(Number(o.listPrice != null ? o.listPrice : o.price) || 0);
}

// Look a code up and confirm it can still be used.
async function usableDiscount(code) {
  const list = await getCollection(K_DISCOUNTS);
  const wanted = normalizeCode(code);
  const d = list.find((x) => x.code === wanted);
  if (!d) throw httpError(404, `No discount with the code ${wanted}.`);
  if (!d.active) throw httpError(409, `${d.code} is switched off.`);
  if (isExpired(d)) throw httpError(409, `${d.code} expired on ${d.expiresAt.slice(0, 10)}.`);
  if (d.maxUses != null && d.uses >= d.maxUses) throw httpError(409, `${d.code} has been used its maximum ${d.maxUses} time(s).`);
  return { list, d };
}

// Put a discount on an order (replacing any existing one) and reprice it.
// Called from inside mutateOrder, so it only touches the order in place.
async function applyDiscountToOrder(o, code, actor) {
  if (!can(actor, 'discount')) throw httpError(403, 'You are not allowed to apply a discount.');
  const { list, d } = await usableDiscount(code);
  const base = listPriceOf(o);
  const amount = discountAmountFor(base, d);
  const newPrice = round2(base - amount);
  const paid = amountPaidOf(o);
  if (newPrice < paid - 0.001) {
    throw httpError(409, `${d.code} would bring the total to ${newPrice}, below the ${paid} already paid. Refund the difference first.`);
  }
  await releaseDiscount(o, list); // giving back a previously applied code
  o.listPrice = base;
  o.discount = { id: d.id, code: d.code, type: d.type, value: d.value, amount, by: actorRef(actor), at: nowIso() };
  o.price = newPrice;
  d.uses = (Number(d.uses) || 0) + 1;
  await saveCollection(K_DISCOUNTS, list);
  repriceStatus(o);
  addLog(o, actor, 'discount', `Discount ${d.code} applied · −${amount} (${d.type === 'percent' ? d.value + '%' : d.value}) · total ${o.price}`);
  return o.discount;
}

// Take a discount off an order and put the price back up.
async function removeDiscountFromOrder(o, actor) {
  if (!o.discount) return null;
  if (!can(actor, 'discount')) throw httpError(403, 'You are not allowed to change a discount.');
  const previous = o.discount;
  const list = await getCollection(K_DISCOUNTS);
  await releaseDiscount(o, list);
  await saveCollection(K_DISCOUNTS, list);
  o.price = listPriceOf(o);
  o.discount = null;
  repriceStatus(o);
  addLog(o, actor, 'discount', `Discount ${previous.code} removed · total back to ${o.price}`);
  return previous;
}

// Hand a use back to the code an order currently holds. Mutates `list` only.
async function releaseDiscount(o, list) {
  if (!o.discount) return;
  const prev = list.find((x) => x.id === o.discount.id);
  if (prev) prev.uses = Math.max(0, (Number(prev.uses) || 0) - 1);
}

// After the price moves, an order can become fully paid (or stop being so).
function repriceStatus(o) {
  const price = Number(o.price) || 0;
  const paid = amountPaidOf(o);
  if (paid <= 0) { o.paymentStatus = 'unpaid'; return; }
  o.paymentStatus = paid >= price - 0.001 ? 'paid' : 'partial';
}

// ------------------------------------------------------------------ Messages --
export async function guestSendMessage(publicId, text) {
  const clean = String(text || '').trim();
  if (!clean) throw httpError(400, 'Message cannot be empty');
  const orders = await getCollection(K_ORDERS);
  const o = orders.find((x) => x.publicId === publicId);
  if (!o) throw httpError(404, 'Order not found');
  o.messages.push({ id: newId('msg'), sender: 'guest', text: clean.slice(0, 1000), at: nowIso(), readByStaff: false });
  o.updatedAt = nowIso();
  await saveCollection(K_ORDERS, orders);
  try { await sendPushToAll({ title: 'New guest message', body: `${o.guestName} · order #${o.number}`, url: '/app', tag: 'msg-' + o.number }); } catch {}
  return publicOrder(o);
}

export async function staffReply(id, text, actor) {
  const clean = String(text || '').trim();
  if (!clean) throw httpError(400, 'Message cannot be empty');
  const settings = await getSettings();
  return mutateOrder(id, async (o) => {
    o.messages.push({ id: newId('msg'), sender: 'staff', staffName: actor?.name || 'Reception', text: clean.slice(0, 1000), at: nowIso(), readByStaff: true });
    o.messages.forEach((m) => { if (m.sender === 'guest') m.readByStaff = true; });
    addLog(o, actor, 'message', 'Replied to guest');
    const withReply = { ...o, _lastReply: clean };
    await notifyGuest('reply', withReply, settings);
    return o;
  });
}

export async function markThreadRead(id) {
  return mutateOrder(id, async (o) => {
    o.messages.forEach((m) => { if (m.sender === 'guest') m.readByStaff = true; });
    return o;
  });
}

export async function listThreads() {
  const orders = await getCollection(K_ORDERS);
  return orders
    .filter((o) => o.messages && o.messages.length)
    .map((o) => ({
      id: o.id,
      publicId: o.publicId,
      number: o.number,
      guestName: o.guestName,
      status: o.status,
      lastMessage: o.messages[o.messages.length - 1],
      unread: o.messages.filter((m) => m.sender === 'guest' && !m.readByStaff).length,
      messages: o.messages,
    }))
    .sort((a, b) => new Date(b.lastMessage.at) - new Date(a.lastMessage.at));
}

// ------------------------------------------------------------- Backup/restore -
// Full snapshot of everything (admin only). Includes cashier PIN hashes so a
// restore reproduces logins exactly — keep the file private.
export async function exportAll() {
  return {
    app: 'hostel-laundry',
    version: 1,
    exportedAt: nowIso(),
    settings: await readJSON(K_SETTINGS, null),
    cashiers: await getCollection(K_CASHIERS),
    orders: await getCollection(K_ORDERS),
    shifts: await getCollection(K_SHIFTS),
    discounts: await getCollection(K_DISCOUNTS),
    meta: await readJSON(K_META, null),
  };
}

export async function importAll(data) {
  if (!data || typeof data !== 'object' || data.app !== 'hostel-laundry') {
    throw httpError(400, 'That doesn\'t look like a laundry backup file.');
  }
  // Safety: never restore a state with no admin (would lock everyone out).
  if (Array.isArray(data.cashiers) && !data.cashiers.some((c) => c.role === 'admin' && c.active !== false)) {
    throw httpError(400, 'Backup has no active admin — refusing to restore (you would be locked out).');
  }
  if (data.settings) await writeJSON(K_SETTINGS, data.settings);
  if (Array.isArray(data.cashiers)) await saveCollection(K_CASHIERS, data.cashiers);
  if (Array.isArray(data.orders)) await saveCollection(K_ORDERS, data.orders);
  if (Array.isArray(data.shifts)) await saveCollection(K_SHIFTS, data.shifts);
  if (Array.isArray(data.discounts)) await saveCollection(K_DISCOUNTS, data.discounts);
  if (data.meta) await writeJSON(K_META, data.meta);
  return {
    ok: true,
    counts: { cashiers: (data.cashiers || []).length, orders: (data.orders || []).length, shifts: (data.shifts || []).length, discounts: (data.discounts || []).length },
  };
}

// ------------------------------------------------------------------- Reports --
export async function revenueReport({ from, to, shift } = {}) {
  const settings = await getSettings();
  const orders = await getCollection(K_ORDERS);
  const fromD = rangeStart(from);
  const toD = rangeEnd(to);
  const shiftFilter = ['AM', 'PM', 'Night'].includes(shift) ? shift : null;

  // Revenue is recognised on orders that were accepted (have a price) within range,
  // excluding cancelled. We use acceptedAt as the revenue date.
  let inRange = orders.filter((o) => {
    if (o.status === 'cancelled' || o.status === 'new') return false;
    const d = new Date(o.acceptedAt || o.createdAt);
    return d >= fromD && d <= toD;
  });
  // Optional: restrict to a single reception shift.
  if (shiftFilter) inRange = inRange.filter((o) => shiftOf(o.acceptedAt || o.createdAt) === shiftFilter);

  // Revenue is what was actually charged, so a discounted order counts at its
  // reduced price; the amount given away is reported separately.
  const revenue = sum(inRange.map((o) => Number(o.price) || 0));
  const totalItems = sum(inRange.map((o) => o.items));
  const totalLoads = sum(inRange.map((o) => o.loads));
  const discountedOrders = inRange.filter((o) => o.discount && (Number(o.discount.amount) || 0) > 0);

  // ---- Money actually collected in the period ----
  // Collected / cash / card are measured by WHEN a payment was taken and WHO took it,
  // not by when the order was accepted. So a payment Jessica records at 09:55 counts
  // for that moment and for her, even if the order was accepted on an earlier day.
  // effectivePayments() also covers money that never reached the ledger — orders
  // paid before the ledger existed, and legacy part-payments topped up since.
  // Every order is scanned, including cancelled ones and orders still sitting at
  // "new": there is no refund flow, so money that was handed over stays in the
  // drawer and still belongs to whoever took it.
  const paymentsInRange = [];
  for (const o of orders) {
    for (const p of effectivePayments(o)) {
      const atIso = p.at || o.paidAt || o.acceptedAt || o.createdAt;
      const at = new Date(atIso);
      if (!(at >= fromD && at <= toD)) continue;
      const pShift = shiftOf(atIso);
      if (shiftFilter && pShift !== shiftFilter) continue;
      paymentsInRange.push({ amount: Number(p.amount) || 0, method: p.method === 'card' ? 'card' : 'cash', at: atIso, shift: pShift, by: p.by || o.paidBy || null, orderNumber: o.number });
    }
  }
  const collected = sum(paymentsInRange.map((p) => p.amount));
  const cashCollected = sum(paymentsInRange.filter((p) => p.method !== 'card').map((p) => p.amount));
  const cardCollected = sum(paymentsInRange.filter((p) => p.method === 'card').map((p) => p.amount));
  const byMethod = { cash: round2(cashCollected), card: round2(cardCollected) };
  // What's still owed on orders that were accepted within this period. Uses the same
  // reading of "paid" as the collected figures, so an order marked paid never shows
  // up as owing its full price just because it predates the amountPaid field.
  const outstanding = sum(inRange.map((o) => Math.max(0, round2((Number(o.price) || 0) - amountPaidOf(o)))));

  // Daily breakdown.
  const byDayMap = {};
  for (const o of inRange) {
    const day = (o.acceptedAt || o.createdAt).slice(0, 10);
    if (!byDayMap[day]) byDayMap[day] = { date: day, orders: 0, revenue: 0, loads: 0, items: 0 };
    byDayMap[day].orders += 1;
    byDayMap[day].revenue += Number(o.price) || 0;
    byDayMap[day].loads += o.loads;
    byDayMap[day].items += o.items;
  }
  const byDay = Object.values(byDayMap).sort((a, b) => a.date.localeCompare(b.date));

  // Shift breakdown. Orders / revenue / loads are counted by the shift the order was
  // ACCEPTED in; collected / cash / card are counted by the shift the payment was TAKEN in.
  const byShift = { AM: shiftBucket('AM'), PM: shiftBucket('PM'), Night: shiftBucket('Night') };
  for (const o of inRange) {
    const s = byShift[shiftOf(o.acceptedAt || o.createdAt)];
    s.orders += 1; s.revenue += Number(o.price) || 0; s.loads += o.loads;
  }
  for (const p of paymentsInRange) {
    const s = byShift[p.shift]; if (!s) continue;
    s.collected += p.amount;
    if (p.method === 'card') s.card += p.amount; else s.cash += p.amount;
    // Keep the individual payments so the UI can show which orders make up the
    // cash and card figures when the shift's Collected total is opened.
    s.payments.push({ number: p.orderNumber, amount: round2(p.amount), method: p.method, at: p.at, by: nameOf(p.by) });
  }
  Object.values(byShift).forEach((s) => {
    s.revenue = round2(s.revenue); s.collected = round2(s.collected); s.cash = round2(s.cash); s.card = round2(s.card);
    s.payments.sort((a, b) => a.at.localeCompare(b.at));
  });

  // Staff activity — who did what (from orders accepted in range) and, separately,
  // the money each person collected (from payments they took within range).
  const staff = {};
  const ensure = (ref) => {
    if (!ref || !ref.name) return null;
    const k = ref.id || ref.name;
    if (!staff[k]) staff[k] = { name: ref.name, accepted: 0, cleaned: 0, ready: 0, completed: 0, payments: 0, collected: 0, cash: 0, card: 0 };
    return staff[k];
  };
  const bump = (ref, field) => { const s = ensure(ref); if (s) s[field] += 1; };
  for (const o of inRange) {
    bump(o.acceptedBy, 'accepted');
    bump(o.cleaningBy, 'cleaned');
    bump(o.readyBy, 'ready');
    bump(o.completedBy, 'completed');
  }
  // A payment with no recorded taker still has to show up somewhere, otherwise the
  // staff column totals silently disagree with the Collected figure at the top.
  for (const p of paymentsInRange) {
    const s = ensure(p.by) || ensure(UNATTRIBUTED_REF);
    s.payments += 1; s.collected += p.amount;
    if (p.method === 'card') s.card += p.amount; else s.cash += p.amount;
  }
  const byStaff = Object.values(staff).map((s) => ({ ...s, collected: round2(s.collected), cash: round2(s.cash), card: round2(s.card) }))
    .sort((a, b) => b.collected - a.collected);

  return {
    currency: settings.currency,
    range: { from: from || null, to: to || null, shift: shiftFilter || 'all' },
    totals: {
      orders: inRange.length,
      revenue: round2(revenue),
      collected: round2(collected),
      outstanding: round2(outstanding),
      items: totalItems,
      loads: totalLoads,
      avgOrderValue: inRange.length ? round2(revenue / inRange.length) : 0,
      paidCount: inRange.filter((o) => o.paymentStatus === 'paid').length,
      partialCount: inRange.filter((o) => o.paymentStatus === 'partial').length,
      unpaidCount: inRange.filter((o) => o.paymentStatus === 'unpaid').length,
      // What discounting cost over the period, on orders accepted in it.
      discounts: round2(sum(discountedOrders.map((o) => Number(o.discount.amount) || 0))),
      discountedCount: discountedOrders.length,
    },
    byMethod: { cash: round2(byMethod.cash), card: round2(byMethod.card) },
    byDay,
    byShift,
    byStaff,
    orders: inRange.map((o) => ({ ...publicOrder(o), shift: shiftOf(o.acceptedAt || o.createdAt) })),
  };
}

function shiftBucket() { return { orders: 0, revenue: 0, collected: 0, cash: 0, card: 0, loads: 0, payments: [] }; }

const UNATTRIBUTED_REF = { id: '__unattributed__', name: 'Unattributed' };

// Report boundaries. A bare date ("2026-06-15") means the whole of that day, and the
// end of the range is inclusive down to the millisecond — otherwise a payment taken
// at 23:59:59.5 falls outside a range that ends at 23:59:59.
function rangeStart(from) {
  if (!from) return new Date(0);
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(from) ? `${from}T00:00:00` : from);
  return isNaN(d) ? new Date(0) : d;
}
function rangeEnd(to) {
  if (!to) return new Date(8640000000000000);
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999` : to);
  if (isNaN(d)) return new Date(8640000000000000);
  // A whole-second boundary was almost certainly meant to include that second.
  if (d.getMilliseconds() === 0) d.setMilliseconds(999);
  return d;
}

// What an order has actually been paid.
//
// The earliest builds recorded a payment as a status and nothing more — they set
// paymentStatus / paymentMethod / paidAt / paidBy but never wrote an amount, because
// amountPaid and the payments ledger did not exist yet. Their order log still reads
// "Payment received · card · shift AM". An order marked paid that carries no figure
// was paid in full, so its price is the amount. A 'partial' order with no figure is
// unknowable and stays at zero rather than being guessed at.
export function amountPaidOf(o) {
  const recorded = Number(o.amountPaid) || 0;
  if (recorded > 0) return round2(recorded);
  return o.paymentStatus === 'paid' ? round2(Number(o.price) || 0) : 0;
}

// Payments for reporting, as a flat list of "money that changed hands".
// The ledger is authoritative where it exists, but an order can carry money that
// never made it into the ledger — orders paid before the ledger existed, or a
// legacy part-payment topped up after it. Anything paid beyond what the ledger
// accounts for is emitted as one synthetic entry so no collected money is dropped.
function effectivePayments(o) {
  const ledger = (o.payments || []).filter((p) => (Number(p.amount) || 0) > 0);
  const unledgered = round2(amountPaidOf(o) - sum(ledger.map((p) => Number(p.amount) || 0)));
  if (unledgered <= 0.001) return ledger;
  return ledger.concat([{
    amount: unledgered,
    method: o.paymentMethod === 'card' ? 'card' : 'cash',
    at: o.paidAt || o.acceptedAt || o.createdAt,
    by: o.paidBy,
  }]);
}

export function reportToCsv(report) {
  const cur = report.currency?.code || '';
  const lines = [];
  lines.push(`Revenue Report,${report.range.from || 'all'},to,${report.range.to || 'all'}`);
  lines.push(`Shift,${report.range.shift || 'all'}`);
  lines.push('');
  lines.push('Metric,Value');
  lines.push(`Total orders,${report.totals.orders}`);
  lines.push(`Total revenue (${cur}),${report.totals.revenue}`);
  lines.push(`Collected (${cur}),${report.totals.collected}`);
  lines.push(`Outstanding (${cur}),${report.totals.outstanding}`);
  lines.push(`Cash (${cur}),${report.byMethod.cash}`);
  lines.push(`Card (${cur}),${report.byMethod.card}`);
  lines.push(`Total items,${report.totals.items}`);
  lines.push(`Total loads,${report.totals.loads}`);
  lines.push(`Average order value (${cur}),${report.totals.avgOrderValue}`);
  lines.push(`Discounts given (${cur}),${report.totals.discounts ?? 0}`);
  lines.push(`Discounted orders,${report.totals.discountedCount ?? 0}`);
  lines.push('');
  lines.push('Daily breakdown');
  lines.push('Date,Orders,Loads,Items,Revenue');
  report.byDay.forEach((d) => lines.push(`${d.date},${d.orders},${d.loads},${d.items},${round2(d.revenue)}`));
  lines.push('');
  lines.push('By shift (collected = payments taken during that shift)');
  lines.push('Shift,Orders,Loads,Revenue,Collected,Cash,Card');
  ['AM', 'PM', 'Night'].forEach((s) => {
    const b = report.byShift[s];
    lines.push(`${s} (${SHIFT_LABEL[s]}),${b.orders},${b.loads},${b.revenue},${b.collected},${b.cash},${b.card}`);
  });
  lines.push('');
  // The individual payments behind each shift's cash and card figures.
  lines.push('Payments behind each shift total');
  lines.push('Shift,Time,Order,Method,Amount,Taken by');
  ['AM', 'PM', 'Night'].forEach((s) => {
    (report.byShift[s].payments || []).forEach((p) => {
      lines.push(`${s},${String(p.at).slice(0, 16).replace('T', ' ')},#${p.number},${p.method},${p.amount},${csv(p.by || 'Unattributed')}`);
    });
  });
  lines.push('');
  lines.push('By staff (collected = payments this person took)');
  lines.push('Staff,Accepted,Cleaned,Ready,Completed,Payments,Collected,Cash,Card');
  (report.byStaff || []).forEach((s) => {
    lines.push(`${csv(s.name)},${s.accepted},${s.cleaned},${s.ready},${s.completed},${s.payments},${s.collected},${s.cash},${s.card}`);
  });
  lines.push('');
  lines.push('Orders');
  lines.push('Number,Date,Shift,Guest,Room,Items,Loads,Price,Discount,Discount off,Payment,Method,Accepted by,Cleaned by,Ready by,Completed by,Paid by,Status');
  report.orders.forEach((o) => {
    lines.push([
      o.number, (o.acceptedAt || o.createdAt).slice(0, 16).replace('T', ' '), o.shift,
      csv(o.guestName), csv(o.room), o.items, o.loads, o.price ?? '',
      o.discount ? o.discount.code : '', o.discount ? o.discount.amount : '',
      o.paymentStatus, o.paymentMethod || '',
      csv(nameOf(o.acceptedBy)), csv(nameOf(o.cleaningBy)), csv(nameOf(o.readyBy)),
      csv(nameOf(o.completedBy)), csv(nameOf(o.paidBy)), o.status,
    ].join(','));
  });
  return lines.join('\n');
}

const SHIFT_LABEL = { AM: '06:00–14:00', PM: '14:00–22:00', Night: '22:00–06:00' };
function nameOf(ref) { return ref && ref.name ? ref.name : ''; }

// ------------------------------------------------------- Stuck-order detection
// Quiet period (no reminders). Default 18:00–07:00 wraps midnight.
export function inQuietHours(date, from, to) {
  const h = new Date(date).getHours();
  if (from === to) return false;
  return from < to ? (h >= from && h < to) : (h >= from || h < to);
}

export const DELAY_SNOOZE_MS = 30 * 60000; // a delay reason silences reminders for 30 min

// True while an order is snoozed by a recent delay reason.
export function isSnoozed(o, now = Date.now()) {
  return !!(o.delayReasonAt && (now - new Date(o.delayReasonAt).getTime()) < DELAY_SNOOZE_MS);
}
// True when pickup is within the lead window (approaching) but not yet past.
// Ready orders are excluded — they're already done, so there's nothing to follow up.
export function pickupApproaching(o, leadMs, now = Date.now()) {
  if (!o.pickupAt || o.status === 'ready') return false;
  const dt = new Date(o.pickupAt).getTime() - now;
  return dt > 0 && dt <= leadMs;
}

// Orders needing a follow-up nudge (for email/push): accepted too long, or within
// the pickup lead window. NOT orders past pickup (no sound after pickup). Respects
// quiet hours, the delay-reason snooze, and the repeat interval.
export async function findFollowUpOrders(settings, now = Date.now()) {
  const s = settings || (await getSettings());
  if (inQuietHours(now, s.quietFrom, s.quietTo)) return [];
  const orders = await getCollection(K_ORDERS);
  const followMs = (s.followUpHours || 1) * 3600000;
  const everyMs = (s.followUpEveryHours || 1) * 3600000;
  const leadMs = (s.pickupLeadHours ?? 3) * 3600000;
  const due = [];
  for (const o of orders) {
    if (!['accepted', 'cleaning', 'ready'].includes(o.status)) continue;
    if (isSnoozed(o, now)) continue;
    const acceptedTooLong = o.status === 'accepted' && o.acceptedAt && (now - new Date(o.acceptedAt).getTime()) > followMs;
    const soon = pickupApproaching(o, leadMs, now);
    if (!acceptedTooLong && !soon) continue;
    if (o.lastFollowUpAt && (now - new Date(o.lastFollowUpAt).getTime()) < everyMs) continue;
    due.push({ ...publicOrder(o), _reason: acceptedTooLong ? 'accepted' : 'pickupSoon' });
  }
  return due;
}

export async function setDelayReason(id, reason, actor) {
  const clean = String(reason || '').trim();
  if (!clean) throw httpError(400, 'Please give a reason for the delay.');
  return mutateOrder(id, async (o) => {
    if (!['accepted', 'cleaning', 'ready'].includes(o.status)) throw httpError(409, 'Only in-progress orders can be snoozed.');
    o.delayReason = clean.slice(0, 300);
    o.delayReasonAt = nowIso();
    addLog(o, actor, 'delay', `Delay reason (${o.status}): ${o.delayReason}`);
    return o;
  });
}

// Orders that have sat at "ready for pickup" longer than readyStuckHours and
// haven't been alerted yet.
export async function findReadyTooLong(settings, now = Date.now()) {
  const s = settings || (await getSettings());
  const orders = await getCollection(K_ORDERS);
  const cutoff = now - (s.readyStuckHours || 12) * 3600000;
  return orders.filter((o) => o.status === 'ready' && o.readyAt && new Date(o.readyAt).getTime() < cutoff && !o.readyAlertedAt);
}

export async function markReadyAlerted(ids, now = Date.now()) {
  const orders = await getCollection(K_ORDERS);
  const set = new Set(ids);
  const iso = new Date(now).toISOString();
  orders.forEach((o) => { if (set.has(o.id)) o.readyAlertedAt = iso; });
  await saveCollection(K_ORDERS, orders);
}

// Emails of the staff members chosen to also receive the ready-stuck alert.
export async function alertUserEmails(ids = []) {
  if (!ids.length) return [];
  const set = new Set(ids.map(String));
  const cashiers = await getCollection(K_CASHIERS);
  return cashiers.filter((c) => set.has(c.id) && validEmail(c.email)).map((c) => c.email);
}

export async function markFollowedUp(ids, now = Date.now()) {
  const orders = await getCollection(K_ORDERS);
  const set = new Set(ids);
  const iso = new Date(now).toISOString();
  orders.forEach((o) => { if (set.has(o.id)) o.lastFollowUpAt = iso; });
  await saveCollection(K_ORDERS, orders);
}

// -------------------------------------------------------------- Shifts -------
// A shift is a reception handover session. At open and close the cashier confirms
// the laundry that is in progress and acknowledges they've physically checked the
// laundry area. (No cash counting.)
export async function getOpenShiftFor(cashierId) {
  const shifts = await getCollection(K_SHIFTS);
  return shifts.find((s) => s.cashierId === cashierId && s.status === 'open') || null;
}

// Orders currently in the laundry area (accepted / cleaning / ready), incl. payment.
async function inProgressOrders() {
  const orders = await getCollection(K_ORDERS);
  return orders
    .filter((o) => ['accepted', 'cleaning', 'ready'].includes(o.status))
    .map((o) => ({ id: o.id, number: o.number, guestName: o.guestName, room: o.room, status: o.status, items: o.items, loads: o.loads, paymentStatus: o.paymentStatus, price: o.price }));
}

export async function openShift({ type, note, acknowledged, confirmedOrderIds, handover }, actor) {
  if (!actor?.id) throw httpError(401, 'Sign in first');
  const mineOpen = await getOpenShiftFor(actor.id);
  if (mineOpen && !handover) throw httpError(409, 'You already have an open shift — close it first.');
  if (!acknowledged) throw httpError(400, 'Please confirm you have checked the laundry area and the items are present.');
  const inProgress = await inProgressOrders();
  const shifts = await getCollection(K_SHIFTS);
  // Single reception: starting a shift auto-closes any other still-open shift (handover).
  shifts.forEach((s) => {
    if (s.status === 'open') {
      s.status = 'closed'; s.closedAt = nowIso();
      s.closingNote = s.closingNote || 'Closed at shift handover';
      s.closingInProgress = inProgress.length;
    }
  });
  const shift = {
    id: newId('shf'),
    cashierId: actor.id,
    cashierName: actor.name,
    type: shiftOf(new Date()), // always the shift that is currently due (ignores any client value)
    openingNote: note ? String(note).slice(0, 300) : '',
    openingInProgress: inProgress.length,
    openingAcknowledged: true,
    openingConfirmedIds: Array.isArray(confirmedOrderIds) ? confirmedOrderIds : inProgress.map((o) => o.id),
    openedAt: nowIso(),
    status: 'open',
    closedAt: null,
    closingNote: '',
    acknowledged: false,
    confirmedOrderIds: [],
    closingInProgress: null,
  };
  shifts.push(shift);
  await saveCollection(K_SHIFTS, shifts);
  return shift;
}

export async function closeShift({ note, acknowledged, confirmedOrderIds }, actor) {
  const shifts = await getCollection(K_SHIFTS);
  const shift = shifts.find((s) => s.cashierId === actor.id && s.status === 'open');
  if (!shift) throw httpError(404, 'You have no open shift.');
  if (!acknowledged) throw httpError(400, 'Please confirm you have checked the laundry area and the items are present.');
  const inProgress = await inProgressOrders();
  shift.activity = await shiftActivity(shift);
  shift.status = 'closed';
  shift.closedAt = nowIso();
  shift.closingNote = note ? String(note).slice(0, 300) : '';
  shift.acknowledged = true;
  shift.confirmedOrderIds = Array.isArray(confirmedOrderIds) ? confirmedOrderIds : inProgress.map((o) => o.id);
  shift.closingInProgress = inProgress.length;
  await saveCollection(K_SHIFTS, shifts);
  return shift;
}

// Is any reception shift currently open (any cashier)?
export async function anyShiftOpen() {
  const shifts = await getCollection(K_SHIFTS);
  return shifts.some((s) => s.status === 'open');
}

// Small meta store (used e.g. to throttle the scheduled shift-open reminder).
export async function getMeta() { return (await readJSON(K_META, {})) || {}; }
export async function setMeta(patch) {
  const m = await getMeta();
  const next = { ...m, ...patch };
  await writeJSON(K_META, next);
  return next;
}

export async function listShifts({ from, to } = {}) {
  const shifts = await getCollection(K_SHIFTS);
  const fromD = from ? new Date(from) : new Date(0);
  const toD = to ? new Date(to) : new Date(8640000000000000);
  return shifts
    .filter((s) => { const d = new Date(s.openedAt); return d >= fromD && d <= toD; })
    .sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));
}

// Summary of what happened during a shift: laundry received, payments taken, picked up.
async function shiftActivity(shift) {
  const orders = await getCollection(K_ORDERS);
  const since = new Date(shift.openedAt).getTime();
  const inWin = (iso) => iso && new Date(iso).getTime() >= since;
  const received = orders.filter((o) => inWin(o.acceptedAt));
  const pickedUp = orders.filter((o) => inWin(o.completedAt));
  const val = (arr) => round2(sum(arr.map((o) => Number(o.price) || 0)));
  // Payments taken during this shift, from the ledger (handles partial payments).
  let pCount = 0; let pTotal = 0; let pCash = 0; let pCard = 0;
  for (const o of orders) for (const p of (o.payments || [])) {
    if (p.shiftId !== shift.id) continue;
    pCount += 1; pTotal += Number(p.amount) || 0;
    if (p.method === 'card') pCard += Number(p.amount) || 0; else pCash += Number(p.amount) || 0;
  }
  return {
    received: { count: received.length, items: sum(received.map((o) => o.items)), loads: sum(received.map((o) => o.loads)), value: val(received) },
    pickedUp: { count: pickedUp.length, value: val(pickedUp) },
    payments: { count: pCount, total: round2(pTotal), cash: round2(pCash), card: round2(pCard) },
  };
}

export async function currentShiftView(actor) {
  const inProgress = await inProgressOrders();
  const shift = actor?.id ? await getOpenShiftFor(actor.id) : null;
  if (!shift) return { open: false, inProgress };
  return { open: true, shift, inProgress, activity: await shiftActivity(shift) };
}

// -------------------------------------------------------------- internals ----
function actorRef(actor) {
  return actor ? { id: actor.id || null, name: actor.name || 'system', role: actor.role || 'system' } : null;
}

async function mutateOrder(id, fn) {
  const orders = await getCollection(K_ORDERS);
  const o = orders.find((x) => x.id === id);
  if (!o) throw httpError(404, 'Order not found');
  const result = await fn(o);
  o.updatedAt = nowIso();
  await saveCollection(K_ORDERS, orders);
  return publicOrder(result || o);
}

async function notifyGuest(kind, order, settings) {
  if (!validEmail(order.guestEmail)) return; // guest ordered without an email — nothing to send
  try {
    const { subject, html } = orderEmail(kind, order, { ...settings, baseUrl: effectiveBaseUrl(settings) });
    const r = await sendEmail({ to: order.guestEmail, subject, html });
    order.logs.push({ id: newId('log'), at: nowIso(), actor: 'system', role: 'system', action: 'email', detail: `Sent "${kind}" email${r.dryRun ? ' (dry-run)' : ''}` });
  } catch (err) {
    order.logs.push({ id: newId('log'), at: nowIso(), actor: 'system', role: 'system', action: 'email-error', detail: String(err.message || err) });
  }
}

function addLog(order, actor, action, detail) {
  order.logs = order.logs || [];
  order.logs.push({
    id: newId('log'), at: nowIso(),
    actor: actor?.name || 'system', role: actor?.role || 'system',
    actorId: actor?.id || null, action, detail,
  });
}

async function nextOrderNumber() {
  const meta = (await readJSON(K_META, { orderSeq: 1000 })) || { orderSeq: 1000 };
  meta.orderSeq = (meta.orderSeq || 1000) + 1;
  await writeJSON(K_META, meta);
  return meta.orderSeq;
}

// 6:00 PM the following day (server clock).
function nextDaySixPM() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(18, 0, 0, 0);
  return d.toISOString();
}

// The number the NEXT created order will get.
export async function getNextOrderNumber() {
  const meta = (await readJSON(K_META, { orderSeq: 1000 })) || { orderSeq: 1000 };
  return (meta.orderSeq || 1000) + 1;
}

// Admin: set what the next order number will be.
export async function setOrderSequence(next) {
  const n = Math.floor(Number(next));
  if (!n || n < 1) throw httpError(400, 'The next order number must be a positive whole number.');
  const meta = (await readJSON(K_META, { orderSeq: 1000 })) || { orderSeq: 1000 };
  meta.orderSeq = n - 1; // so the next created order is exactly n
  await writeJSON(K_META, meta);
  return { next: n };
}

async function pinInUse(pin, cashiers, exceptId) {
  return cashiers.some((c) => c.id !== exceptId && verifyPin(String(pin), c.salt, c.hash));
}

function publicCashier(c) {
  return { id: c.id, name: c.name, email: c.email || '', role: c.role, permissions: c.role === 'admin' ? {} : c.permissions, active: c.active, createdAt: c.createdAt };
}

function publicOrder(o) {
  const { ...rest } = o;
  return rest;
}

function validatePin(pin) {
  if (!/^\d{4,8}$/.test(String(pin || ''))) throw httpError(400, 'PIN must be 4–8 digits');
}
function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ''));
}
export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
function nowIso() { return new Date().toISOString(); }
function clampHour(v, def) {
  if (v === '' || v == null) return def;
  const n = Math.floor(Number(v));
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : def;
}
function sum(arr) { return arr.reduce((a, b) => a + (Number(b) || 0), 0); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function csv(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
