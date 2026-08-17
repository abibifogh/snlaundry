// Reception / Admin single-page app.
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const TOKEN_KEY = 'laundry_token';

const state = {
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: null,
  perms: {},
  catalogue: {},
  discounts: [], // codes this user may apply, loaded on sign-in
  settings: null,
  tab: 'orders',
  pin: '',
  poll: null,
};

const STATUS_LABEL = { new: 'New', accepted: 'Accepted', cleaning: 'Cleaning', ready: 'Ready', completed: 'Completed', cancelled: 'Cancelled' };
const REVERSE_LABEL = { completed: 'Ready', ready: 'Cleaning', cleaning: 'Accepted' };
function attributionRows(o) {
  const rows = [
    ['Accepted by', o.acceptedBy], ['Cleaned by', o.cleaningBy],
    ['Marked ready by', o.readyBy], ['Picked up by', o.completedBy],
  ].filter(([, v]) => v && v.name);
  return rows.map(([k, v]) => `<tr><td class="muted">${k}</td><td>${esc(v.name)}</td></tr>`).join('');
}

// ---------------- API ----------------
async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  const res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && state.user) { lock(); throw new Error('Session expired — please re-enter your PIN.'); }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.error) || 'Request failed');
  return data;
}

function can(perm) {
  if (!state.user) return false;
  if (state.user.role === 'admin') return true;
  return !!state.perms[perm];
}

// ---------------- new-order ping ----------------
let _audioCtx = null;
state.muted = localStorage.getItem('laundry_muted') === '1';
state.knownOrderIds = null; // set of order ids we've already seen

function initAudio() {
  if (_audioCtx) return;
  try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
}
function ping() {
  if (state.muted || !_audioCtx) return;
  try {
    const t = _audioCtx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = _audioCtx.createOscillator();
      const gain = _audioCtx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.28, t + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.16);
      osc.connect(gain); gain.connect(_audioCtx.destination);
      osc.start(t + i * 0.18); osc.stop(t + i * 0.18 + 0.18);
    });
  } catch {}
}
function toggleMute() {
  state.muted = !state.muted;
  localStorage.setItem('laundry_muted', state.muted ? '1' : '0');
  const b = document.getElementById('muteBtn');
  if (b) b.textContent = state.muted ? '🔕 Sound off' : '🔔 Sound on';
  if (!state.muted) { initAudio(); ping(); }
}
// A distinct, lower "start a shift" chime (three equal pulses).
function shiftPing() {
  if (state.muted || !_audioCtx) return;
  try {
    const t = _audioCtx.currentTime;
    [0, 0.22, 0.44].forEach((off) => {
      const osc = _audioCtx.createOscillator();
      const gain = _audioCtx.createGain();
      osc.type = 'triangle'; osc.frequency.value = 392; // G4, calmer than the order ping
      gain.gain.setValueAtTime(0.0001, t + off);
      gain.gain.exponentialRampToValueAtTime(0.22, t + off + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.16);
      osc.connect(gain); gain.connect(_audioCtx.destination);
      osc.start(t + off); osc.stop(t + off + 0.18);
    });
  } catch {}
}
// A distinct "new guest message" chime (two quick mid tones).
function msgPing() {
  if (state.muted || !_audioCtx) return;
  try {
    const t = _audioCtx.currentTime;
    [660, 990].forEach((f, i) => {
      const osc = _audioCtx.createOscillator();
      const gain = _audioCtx.createGain();
      osc.type = 'square'; osc.frequency.value = f;
      const off = i * 0.13;
      gain.gain.setValueAtTime(0.0001, t + off);
      gain.gain.exponentialRampToValueAtTime(0.16, t + off + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.10);
      osc.connect(gain); gain.connect(_audioCtx.destination);
      osc.start(t + off); osc.stop(t + off + 0.12);
    });
  } catch {}
}
// A distinct "go follow up on laundry" chime (three bright beeps).
function followUpPing() {
  if (state.muted || !_audioCtx) return;
  try {
    const t = _audioCtx.currentTime;
    [0, 0.14, 0.28].forEach((off) => {
      const osc = _audioCtx.createOscillator();
      const gain = _audioCtx.createGain();
      osc.type = 'sine'; osc.frequency.value = 988; // B5
      gain.gain.setValueAtTime(0.0001, t + off);
      gain.gain.exponentialRampToValueAtTime(0.26, t + off + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.11);
      osc.connect(gain); gain.connect(_audioCtx.destination);
      osc.start(t + off); osc.stop(t + off + 0.12);
    });
  } catch {}
}
function currentShiftType() {
  const h = new Date().getHours();
  return (h >= 6 && h < 14) ? 'AM' : (h >= 14 && h < 22) ? 'PM' : 'Night';
}

// ---- follow-up helpers ----
function inQuietHoursNow() {
  const s = state.settings || {};
  const from = Number.isInteger(s.quietFrom) ? s.quietFrom : 18;
  const to = Number.isInteger(s.quietTo) ? s.quietTo : 7;
  if (from === to) return false;
  const h = new Date().getHours();
  return from < to ? (h >= from && h < to) : (h >= from || h < to);
}
function acceptedTooLong(o) {
  const followMs = (state.settings?.followUpHours || 1) * 3600000;
  return o.status === 'accepted' && o.acceptedAt && (Date.now() - new Date(o.acceptedAt)) > followMs;
}
function pickupApproaching(o) {
  const lead = (state.settings?.pickupLeadHours ?? 3) * 3600000;
  if (!o.pickupAt || o.status === 'ready') return false; // ready = done, no pre-pickup nudge
  const dt = new Date(o.pickupAt) - new Date();
  return dt > 0 && dt <= lead;
}
function pickupPast(o) {
  return ['accepted', 'cleaning', 'ready'].includes(o.status) && o.pickupAt && new Date(o.pickupAt) < new Date();
}
function isSnoozedO(o) {
  return o.delayReasonAt && (Date.now() - new Date(o.delayReasonAt)) < 30 * 60000;
}
// Does this order need an audible follow-up for the CURRENT user's role?
// (Never after pickup time — only accepted-too-long or approaching pickup.)
function needsFollowUp(o) {
  if (!['accepted', 'cleaning', 'ready'].includes(o.status)) return false;
  if (isSnoozedO(o)) return false;
  if (state.user?.role === 'laundry') {
    // laundry: any accepted order (start cleaning) or approaching pickup (check lines)
    return o.status === 'accepted' || pickupApproaching(o);
  }
  // reception (admin / cashier): accepted too long, or approaching pickup
  return acceptedTooLong(o) || pickupApproaching(o);
}

// Refresh the alert counters (new orders, follow-ups, unread messages) even when the
// user isn't on the Orders/Messages tab — these drive the repeating chimes.
async function refreshAlerts() {
  try {
    const orders = await api('GET', '/orders');
    state.pendingNew = orders.filter(o => o.status === 'new').length;
    state.pendingFollowUp = inQuietHoursNow() ? 0 : orders.filter(needsFollowUp).length;
    state.pendingMsg = can('messageGuests')
      ? orders.reduce((n, o) => n + (o.messages || []).filter(m => m.sender === 'guest' && !m.readByStaff).length, 0)
      : 0;
    if (state.pendingFollowUp > (state._lastFollowUp || 0)) notifyBg('Laundry needs follow-up', `${state.pendingFollowUp} order(s) need attention at the laundry`, 'follow-up');
    state._lastFollowUp = state.pendingFollowUp;
  } catch { /* keep last values */ }
}

// ---------------- idle auto-lock (5 minutes) ----------------
let _idleTimer = null;
function resetIdle() {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => { if (state.user) lock(); }, 5 * 60 * 1000);
}
['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach((ev) =>
  document.addEventListener(ev, () => { if (state.user) resetIdle(); }, { passive: true }));

// Let staff type their PIN on a physical keyboard (PC) when the lock screen is up.
document.addEventListener('keydown', (e) => {
  const lock = document.getElementById('lockScreen');
  if (!lock || lock.classList.contains('hidden')) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;
  if (/^[0-9]$/.test(e.key)) { e.preventDefault(); pinKey(e.key); }
  else if (e.key === 'Backspace') { e.preventDefault(); pinKey('⌫'); }
  else if (e.key === 'Enter') { e.preventDefault(); pinKey('OK'); }
});

// ---------------- helpers ----------------
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function cur() { return state.settings?.currency?.symbol || ''; }
function money(n) { return n == null ? '—' : `${cur()}${Number(n).toFixed(2)}`; }
function fmt(iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return iso; } }
function ago(iso) { if (!iso) return ''; const h = (Date.now() - new Date(iso)) / 3600000; return h < 1 ? `${Math.round(h * 60)}m ago` : `${h.toFixed(1)}h ago`; }
function toLocalInput(iso) { const d = iso ? new Date(iso) : new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
function notice(el, kind, text) { el.innerHTML = text ? `<div class="notice ${kind}">${esc(text)}</div>` : ''; }

// ---------------- PWA + push notifications ----------------
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  // When a new version of the app takes control, reload once so fresh code loads.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });
}
function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
function urlBase64ToUint8Array(b64) {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
window.enableNotifications = async () => {
  if (!pushSupported()) { alert('This browser does not support notifications.'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { alert('Notifications are blocked for this site. Allow them in your browser settings, then tap Enable alerts again.'); return; }
  try {
    const reg = await navigator.serviceWorker.ready;
    const { key } = await (await fetch('/api/push/key')).json();
    if (!key) {
      alert('Permission granted — but background push isn\'t configured on the server yet, so this device can\'t be registered. An admin needs to add the VAPID keys, then tap Enable alerts again on each device.');
      return;
    }
    const sub = (await reg.pushManager.getSubscription())
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
    const label = `${state.user?.name || 'Staff'} · ${(navigator.platform || 'device')}`;
    await api('POST', '/push/subscribe', { subscription: sub.toJSON ? sub.toJSON() : sub, label });
    alert('✓ Alerts enabled on this device. An admin can see it under Settings → Notification devices.');
  } catch (e) { alert('Could not enable background alerts: ' + (e.message || e)); }
};
function updateNotifyBtn() {
  const b = document.getElementById('notifyBtn');
  if (!b) return;
  // Keep the button available whenever push is supported so a device can (re)register
  // — e.g. after VAPID keys are added.
  b.classList.toggle('hidden', !pushSupported());
}
// Fallback: show a system notification while the tab is in the background even if
// server push isn't configured (works as long as the browser is running).
function notifyBg(title, body, tag) {
  if (document.visibilityState === 'visible') return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try { navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, { body, icon: '/icon-192.png', badge: '/icon-192.png', tag: tag || 'laundry-bg', renotify: true })); } catch {}
}

// ---------------- boot ----------------
async function boot() {
  registerSW();
  let status;
  try { status = await api('GET', '/status'); } catch { status = {}; }
  if (!status.isSetup) return showSetup();
  if (state.token) {
    try {
      const me = await api('GET', '/me');
      state.user = me.user; state.perms = me.user.permissions || {}; state.catalogue = me.permissionCatalogue;
      state.settings = await api('GET', '/settings');
      await loadDiscounts();
      return enterApp();
    } catch { state.token = null; localStorage.removeItem(TOKEN_KEY); }
  }
  showLock();
}

// ---------------- setup ----------------
function showSetup() {
  hideAll(); $('#setupScreen').classList.remove('hidden');
  $('#setupBtn').onclick = async () => {
    const pin = $('#setupPin').value.trim();
    if (pin !== $('#setupPin2').value.trim()) return notice($('#setupMsg'), 'err', 'PINs do not match.');
    if (!/^\d{4,8}$/.test(pin)) return notice($('#setupMsg'), 'err', 'PIN must be 4–8 digits.');
    try {
      await api('POST', '/setup', { hostelName: $('#setupHostel').value.trim(), adminName: $('#setupAdmin').value.trim() || 'Admin', adminPin: pin });
      const auth = await api('POST', '/auth/pin', { pin });
      afterAuth(auth);
    } catch (e) { notice($('#setupMsg'), 'err', e.message); }
  };
}

// ---------------- lock / PIN ----------------
function hideAll() { ['setupScreen', 'lockScreen', 'app'].forEach(id => $('#' + id).classList.add('hidden')); }

async function showLock() {
  hideAll(); $('#lockScreen').classList.remove('hidden');
  state.pin = ''; renderPinDots();
  try { const s = await (await fetch('/api/public-settings')).json();
    if (s.accentColor) document.documentElement.style.setProperty('--accent', s.accentColor);
    if (s.hoverColor) document.documentElement.style.setProperty('--hover', s.hoverColor);
    $('#lockName').textContent = s.hostelName || 'Laundry';
    if (s.logoDataUrl && !$('#lockBrand img')) { const i = document.createElement('img'); i.src = s.logoDataUrl; $('#lockBrand').prepend(i); }
  } catch {}
  buildPinpad();
  renderShiftEndBanner();
}

function renderShiftEndBanner() {
  const card = document.querySelector('#lockScreen .card');
  const h2 = card.querySelector('h2');
  const hint = card.querySelector('.hint');
  let banner = document.getElementById('shiftEndBanner');
  if (!state.shiftEnded) {
    if (banner) banner.remove();
    h2.textContent = 'Enter your PIN';
    hint.textContent = 'Each cashier has their own PIN. No full login needed.';
    return;
  }
  h2.textContent = `${state.shiftEnded.oldType} shift has ended`;
  if (!banner) { banner = document.createElement('div'); banner.id = 'shiftEndBanner'; card.insertBefore(banner, $('#pinDots')); }
  banner.innerHTML = `
    <div class="notice info" style="text-align:left">It's now the <b>${state.shiftEnded.newType}</b> shift period. Continue the ${state.shiftEnded.oldType} shift, or start a new one — then enter a PIN.</div>
    <div class="row" style="margin:10px 0 4px">
      <button class="${state.continueMode ? '' : 'secondary'} small" id="btnNewShift">Start new shift</button>
      <button class="${state.continueMode ? 'small' : 'secondary small'}" id="btnContinueShift">Continue ${state.shiftEnded.oldType} shift</button>
    </div>`;
  hint.textContent = state.continueMode
    ? `Enter ${state.shiftEnded.starterName}'s PIN (the cashier who started the ${state.shiftEnded.oldType} shift).`
    : 'Enter your PIN to start a new shift.';
  $('#btnContinueShift').onclick = () => { state.continueMode = true; renderShiftEndBanner(); };
  $('#btnNewShift').onclick = () => { state.continueMode = false; renderShiftEndBanner(); };
}
function renderPinDots() { $('#pinDots').textContent = state.pin.replace(/./g, '•') || ' '; }
function buildPinpad() {
  const pad = $('#pinpad'); pad.innerHTML = '';
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'];
  keys.forEach(k => { const b = document.createElement('button'); b.textContent = k; b.onclick = () => pinKey(k); pad.appendChild(b); });
}
async function pinKey(k) {
  notice($('#pinMsg'), '', '');
  if (k === '⌫') { state.pin = state.pin.slice(0, -1); return renderPinDots(); }
  if (k === 'OK') return submitPin();
  if (state.pin.length >= 8) return;
  state.pin += k; renderPinDots();
  if (state.pin.length === 8) submitPin();
}
async function submitPin() {
  if (state.pin.length < 4) return notice($('#pinMsg'), 'err', 'PIN is at least 4 digits.');
  let auth;
  try { auth = await api('POST', '/auth/pin', { pin: state.pin }); }
  catch { state.pin = ''; renderPinDots(); return notice($('#pinMsg'), 'err', 'Incorrect PIN. Try again.'); }

  // Shift-boundary lock: decide continue vs. start-new.
  if (state.shiftEnded) {
    const key = state.shiftEnded.shiftId + ':' + state.shiftEnded.newType;
    if (state.continueMode) {
      if (auth.user.id !== state.shiftEnded.starterId) {
        state.pin = ''; renderPinDots();
        return notice($('#pinMsg'), 'err', `To continue, enter ${state.shiftEnded.starterName}'s PIN (who started the ${state.shiftEnded.oldType} shift).`);
      }
      state._boundaryHandledFor = key; state.shiftEnded = null; state.continueMode = false;
      return afterAuth(auth); // resume — shift stays open
    }
    // start a new shift after signing in
    state._boundaryHandledFor = key; state.shiftEnded = null; state.continueMode = false;
    state.pendingStartShift = true;
    return afterAuth(auth);
  }
  afterAuth(auth);
}
async function afterAuth(auth) {
  state.token = auth.token; localStorage.setItem(TOKEN_KEY, auth.token);
  const me = await api('GET', '/me');
  state.user = me.user; state.perms = me.user.permissions || {}; state.catalogue = me.permissionCatalogue;
  state.settings = await api('GET', '/settings');
  await loadDiscounts();
  enterApp();
}
function lock() {
  state.token = null; state.user = null; localStorage.removeItem(TOKEN_KEY);
  if (state.poll) clearInterval(state.poll);
  if (state.pingTimer) clearInterval(state.pingTimer);
  if (_idleTimer) clearTimeout(_idleTimer);
  state.pendingNew = 0;
  // If the open shift's period has elapsed, re-show the continue/new prompt on the
  // lock screen — every automatic (or manual) lock, until a new shift is opened.
  const s = state.shift;
  if (s && s.open && s.shift && s.shift.type !== currentShiftType()) {
    state.shiftEnded = { shiftId: s.shift.id, starterId: s.shift.cashierId, starterName: s.shift.cashierName, oldType: s.shift.type, newType: currentShiftType() };
    state.continueMode = false;
  } else {
    state.shiftEnded = null;
  }
  showLock();
}

// ---------------- app shell ----------------
async function enterApp() {
  hideAll(); $('#app').classList.remove('hidden');
  initAudio(); // PIN entry is a user gesture, so audio is now allowed
  $('#topName').textContent = state.settings?.hostelName || 'Laundry';
  if (state.settings?.accentColor) document.documentElement.style.setProperty('--accent', state.settings.accentColor);
  document.documentElement.style.setProperty('--hover', state.settings?.hoverColor || '#FFF8ED');
  $('#whoName').textContent = state.user.name;
  $('#whoRole').textContent = state.user.role;
  $('#lockBtn').onclick = lock;
  ensureTopbarControls();
  resetIdle();
  state.knownOrderIds = null;
  state.pendingMsg = 0; state.pendingFollowUp = 0; state._lastFollowUp = 0; state._lastFollowUpPing = 0;
  await refreshShift(); // load shift status before first render so the shift bar shows
  await refreshAlerts();
  buildTabs();
  selectTab('orders');
  checkShiftBoundary();
  if (state.pendingStartShift) { state.pendingStartShift = false; state._startHandover = true; openStartShift(); }
  if (state.poll) clearInterval(state.poll);
  state.poll = setInterval(async () => {
    await refreshAlerts(); // watch new orders, stuck orders & messages even when off those tabs
    if (state.tab === 'orders') await refreshShift(); // keep the shift bar's in-progress count current
    if (['orders', 'messages'].includes(state.tab)) renderTab(true);
  }, 15000);
  // Repeating alerts (priority: new order → stuck order → unread message → no shift open).
  if (state.pingTimer) clearInterval(state.pingTimer);
  state.pingTick = 0;
  state.pingTimer = setInterval(() => {
    state.pingTick += 1;
    const now = Date.now();
    // New orders and messages chime continuously; the shift-due chime as before.
    if (state.pendingNew > 0) ping();
    else if (state.pendingMsg > 0) msgPing();
    else if (!(state.shift && state.shift.open) && state.pingTick % 2 === 0) shiftPing();
    // Follow-up reminders play on a 30-minute cadence (and immediately on first detection).
    if (state.pendingFollowUp > 0) {
      if (!state._lastFollowUpPing || now - state._lastFollowUpPing >= 30 * 60000) {
        followUpPing();
        state._lastFollowUpPing = now;
      }
    } else {
      state._lastFollowUpPing = 0;
    }
    checkShiftBoundary();
  }, 6000);
}

function checkShiftBoundary() {
  const s = state.shift;
  if (!(s && s.open && s.shift)) return;
  const cur = currentShiftType();
  if (cur === s.shift.type) return;
  const key = s.shift.id + ':' + cur;
  // Only force a lock the first time this crossing is detected; after the user
  // chooses "continue", they can keep working. Subsequent auto-locks (idle) will
  // re-prompt because lock() itself detects the expired shift.
  if (state._boundaryHandledFor === key) return;
  lock();
}

function ensureTopbarControls() {
  const lockBtn = $('#lockBtn');
  // "Enable alerts" — available to all staff so they can subscribe to push.
  if (!document.getElementById('notifyBtn')) {
    const n = document.createElement('button');
    n.id = 'notifyBtn'; n.className = 'ghost small';
    n.textContent = '🔔 Enable alerts';
    n.onclick = () => window.enableNotifications();
    lockBtn.parentNode.insertBefore(n, lockBtn);
  }
  updateNotifyBtn();
  // Mute toggle — only an admin may turn the sound off.
  const existing = document.getElementById('muteBtn');
  if (existing) existing.remove();
  if (state.user.role === 'admin') {
    const mute = document.createElement('button');
    mute.id = 'muteBtn'; mute.className = 'ghost small';
    mute.textContent = state.muted ? '🔕 Sound off' : '🔔 Sound on';
    mute.onclick = toggleMute;
    lockBtn.parentNode.insertBefore(mute, lockBtn);
  }
}

// ---------------- shift (till session) ----------------
async function refreshShift() {
  try { state.shift = await api('GET', '/shifts/current'); } catch { state.shift = { open: false }; }
}
function shiftBarHtml() {
  const s = state.shift;
  if (!s) return '';
  const ip = (s.inProgress || []).length;
  if (s.open) {
    return `<div class="shiftbar">
      <span>🟢 <b>${s.shift.type} shift</b> open · since ${fmt(s.shift.openedAt)} · <b>${ip}</b> laundry order(s) in progress</span>
      <span class="spacer"></span>
      <button class="small secondary" onclick="openCloseShift()">Close shift</button>
    </div>`;
  }
  return `<div class="shiftbar">
    <span>⚪ No shift open. Start one to record this handover.</span>
    <span class="spacer"></span>
    <button class="small secondary" onclick="openStartShift()">Start shift</button>
  </div>`;
}
function inProgressListHtml(list, withChecks) {
  if (!list.length) return '<p class="muted" style="font-size:13px">No laundry currently in progress.</p>';
  return `<div class="stack" style="max-height:230px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:10px">
    ${list.map(o => `<label style="display:flex;gap:9px;align-items:center;font-weight:400;margin:0">
      ${withChecks ? `<input type="checkbox" class="ipchk" value="${o.id}" checked style="width:auto">` : ''}
      <span>#${o.number} · ${esc(o.guestName)}${o.room ? ' · ' + esc(o.room) : ''} · <span class="badge b-${o.status}">${STATUS_LABEL[o.status]}</span> · ${o.items} item(s) ${o.paymentStatus !== 'paid' ? '<span class="badge" style="background:var(--danger)">unpaid</span>' : ''}</span>
    </label>`).join('')}
  </div>`;
}
window.openStartShift = () => {
  const due = currentShiftType();
  const label = { AM: 'AM (06:00–14:00)', PM: 'PM (14:00–22:00)', Night: 'Night (22:00–06:00)' }[due];
  const ip = state.shift?.inProgress || [];
  const unpaid = ip.filter(o => o.paymentStatus !== 'paid').length;
  openModal(`
    <button class="ghost small close" onclick="closeModal()">✕</button>
    <h3>Start shift</h3>
    <p class="hint">You're taking over <b>${ip.length}</b> laundry order(s) in progress${unpaid ? `, of which <b>${unpaid}</b> are still unpaid` : ''}. Confirm the items are present.</p>
    <div id="shMsg"></div>
    <label>Shift <span class="muted">— set automatically for the current time</span></label>
    <input value="${label}" disabled>
    <label>Laundry you're starting with (unpaid items flagged)</label>
    ${inProgressListHtml(ip, true)}
    <label style="display:flex;gap:9px;align-items:flex-start;font-weight:400;margin-top:14px">
      <input type="checkbox" id="shAck" style="width:auto;margin-top:3px">
      <span>I have checked the laundry area and confirm these items are present, and I've noted the unpaid ones.</span>
    </label>
    <label>Note <span class="muted">(optional)</span></label>
    <input id="shNote" placeholder="e.g. handover from PM shift">
    <button class="btn-full" style="margin-top:16px" onclick="doStartShift()">Start ${due} shift</button>
  `);
};
window.doStartShift = async () => {
  if (!$('#shAck').checked) return notice($('#shMsg'), 'err', 'Please tick the box to confirm you checked the laundry area.');
  const confirmedOrderIds = [...document.querySelectorAll('.ipchk:checked')].map(c => c.value);
  const handover = !!state._startHandover;
  try {
    await api('POST', '/shifts/open', { type: currentShiftType(), note: $('#shNote').value.trim(), acknowledged: true, confirmedOrderIds, handover });
    state._startHandover = false;
    closeModal(); await refreshShift(); renderTab();
  } catch (e) { notice($('#shMsg'), 'err', e.message); }
};
window.openCloseShift = async () => {
  await refreshShift(); // refresh so picked-up orders aren't shown as still in progress
  const s = state.shift.shift; const ip = state.shift.inProgress || []; const a = state.shift.activity || {};
  const cur = () => state.settings?.currency?.symbol || '';
  const m2 = (n) => `${cur()}${Number(n || 0).toFixed(2)}`;
  openModal(`
    <button class="ghost small close" onclick="closeModal()">✕</button>
    <h3>Close ${s.type} shift</h3>
    <p class="hint">Here's what happened this shift. Confirm the laundry still in progress is present, then acknowledge.</p>
    <div id="shMsg"></div>
    <label>Shift summary</label>
    <table class="data" style="margin-bottom:10px">
      <tr><td class="muted">Laundry received</td><td style="text-align:right">${a.received?.count || 0} order(s) · ${a.received?.items || 0} items · ${m2(a.received?.value)}</td></tr>
      <tr><td class="muted">Payments taken</td><td style="text-align:right">${a.payments?.count || 0} · <b>${m2(a.payments?.total)}</b> (${m2(a.payments?.cash)} cash / ${m2(a.payments?.card)} card)</td></tr>
      <tr><td class="muted">Picked up</td><td style="text-align:right">${a.pickedUp?.count || 0} order(s)</td></tr>
    </table>
    <label>Laundry still in progress (${ip.length}) — confirm present</label>
    ${inProgressListHtml(ip, true)}
    <label style="display:flex;gap:9px;align-items:flex-start;font-weight:400;margin-top:14px">
      <input type="checkbox" id="ackChk" style="width:auto;margin-top:3px">
      <span>I have checked the laundry area and confirm these items are physically present.</span>
    </label>
    <label>Handover note <span class="muted">(optional)</span></label>
    <input id="clNote" placeholder="e.g. Duafe order needs re-wash">
    <button class="btn-full" style="margin-top:16px" onclick="doCloseShift()">Close shift</button>
  `);
};
window.doCloseShift = async () => {
  if (!$('#ackChk').checked) return notice($('#shMsg'), 'err', 'Please tick the box to confirm you checked the laundry area.');
  const confirmedOrderIds = [...document.querySelectorAll('.ipchk:checked')].map(c => c.value);
  try {
    await api('POST', '/shifts/close', { acknowledged: true, confirmedOrderIds, note: $('#clNote').value.trim() });
    closeModal(); await refreshShift(); renderTab();
    alert('Shift closed — laundry handover confirmed. ✓');
  } catch (e) { notice($('#shMsg'), 'err', e.message); }
};

function buildTabs() {
  const tabs = [{ id: 'orders', label: 'Orders' }];
  if (can('messageGuests')) tabs.push({ id: 'messages', label: 'Messages' });
  if (can('viewReports')) tabs.push({ id: 'reports', label: 'Reports' });
  if (can('manageCashiers')) tabs.push({ id: 'cashiers', label: 'Cashiers' });
  if (can('manageSettings')) tabs.push({ id: 'settings', label: 'Settings' });
  const host = $('#tabs'); host.innerHTML = '';
  tabs.forEach(t => {
    const b = document.createElement('button');
    b.dataset.tab = t.id; b.innerHTML = `${t.label}<span class="tab-badge hidden" id="badge-${t.id}"></span>`;
    b.onclick = () => selectTab(t.id);
    host.appendChild(b);
  });
}
function selectTab(id) {
  state.tab = id;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  renderTab();
}
async function renderTab(silent) {
  const view = $('#view');
  try {
    if (state.tab === 'orders') return renderOrders(view, silent);
    if (state.tab === 'messages') return renderMessages(view, silent);
    if (state.tab === 'reports') return renderReports(view);
    if (state.tab === 'cashiers') return renderCashiers(view);
    if (state.tab === 'settings') return renderSettings(view);
  } catch (e) { if (!silent) view.innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
}

// ---------------- ORDERS ----------------
async function renderOrders(view, silent) {
  const orders = await api('GET', '/orders');
  // Detect genuinely new orders → play the reception ping.
  const newIds = orders.filter(o => o.status === 'new').map(o => o.id);
  state.pendingNew = newIds.length; // drives the repeating ping until all are accepted
  if (state.knownOrderIds !== null) {
    const fresh = newIds.filter(id => !state.knownOrderIds.includes(id));
    if (fresh.length) { ping(); notifyBg('New laundry order', `${fresh.length} new order(s) awaiting acceptance`, 'new-order'); }
  }
  state.knownOrderIds = newIds;
  state.pendingFollowUp = inQuietHoursNow() ? 0 : orders.filter(needsFollowUp).length;
  if (can('messageGuests')) {
    state.pendingMsg = orders.reduce((n, o) => n + (o.messages || []).filter(m => m.sender === 'guest' && !m.readByStaff).length, 0);
  }

  // Laundry staff finish at "mark ready"; hide the Ready-for-pickup column from them.
  const cols = state.user?.role === 'laundry' ? ['new', 'accepted', 'cleaning'] : ['new', 'accepted', 'cleaning', 'ready'];
  const colTitle = { new: 'New — awaiting acceptance', accepted: 'Accepted', cleaning: 'Cleaning', ready: 'Ready for pickup' };
  const newCount = orders.filter(o => o.status === 'new').length;

  const boards = cols.map(st => {
    const items = orders.filter(o => o.status === st);
    return `<div class="col"><h3>${colTitle[st]} (${items.length})</h3>${items.map(orderCard).join('') || '<p class="muted" style="margin:6px 4px;font-size:13px">None</p>'}</div>`;
  }).join('');

  const recent = orders.filter(o => ['completed', 'cancelled'].includes(o.status)).slice(0, 12);
  view.innerHTML = `
    ${shiftBarHtml()}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h2 style="margin:0">Orders ${newCount ? `<span class="pill">${newCount} new</span>` : ''}${state.pendingFollowUp ? ` <span class="pill" style="background:#fbe4e0;color:#992d20">${state.pendingFollowUp} need follow-up</span>` : ''}</h2>
      <button class="small secondary" onclick="location.reload()">↻ Refresh</button>
    </div>
    <div class="cols">${boards}</div>
    <h3 style="margin-top:26px;color:var(--muted)">Recently completed / cancelled</h3>
    <div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Guest</th><th>Room</th><th>Items</th><th>Total</th><th>Status</th><th>When</th></tr></thead>
    <tbody>${recent.map(o => `<tr onclick="openOrder('${o.id}')"><td>#${o.number}</td><td>${esc(o.guestName)}</td><td>${esc(o.room || '—')}</td><td>${o.items}</td><td>${money(o.price)}</td><td><span class="badge b-${o.status}">${STATUS_LABEL[o.status]}</span></td><td class="muted">${fmt(o.completedAt || o.updatedAt)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">None yet</td></tr>'}</tbody></table></div>`;
  window._orders = orders;
}

function orderCard(o) {
  const snoozed = isSnoozedO(o);
  const flagAccepted = !snoozed && acceptedTooLong(o);
  const flagSoon = !snoozed && pickupApproaching(o);
  const flagPast = pickupPast(o);
  const nextBtn = { accepted: 'Start cleaning', cleaning: 'Mark ready', ready: 'Mark picked up' }[o.status];
  const laundryBlocked = o.status === 'ready' && state.user?.role === 'laundry'; // laundry can't complete
  const unread = (o.messages || []).filter(m => m.sender === 'guest' && !m.readByStaff).length;
  const unpaid = o.paymentStatus !== 'paid';
  const blockPickup = o.status === 'ready' && unpaid; // can't complete until paid
  return `<div class="ocard" onclick="openOrder('${o.id}')">
    <div class="top"><span class="num">#${o.number}</span><span class="badge b-${o.status}">${STATUS_LABEL[o.status]}</span></div>
    <div>${esc(o.guestName)} ${o.room ? `· Room ${esc(o.room)}` : ''} ${unread ? `<span class="tab-badge">${unread}✉</span>` : ''}</div>
    <div class="meta">${o.items} items · ${o.loads} load(s) · ${money(o.price)}${o.discount ? ` <span class="pill">${esc(o.discount.code)}</span>` : ''} · ${o.status === 'new' ? paymentPref(o) : paymentLabel(o)}</div>
    <div class="meta">${o.status === 'new' ? 'Placed ' + ago(o.createdAt) : 'Ready by ' + fmt(o.pickupAt)}</div>
    ${snoozed ? '<div class="meta" style="color:var(--muted)">🔕 snoozed · ' + esc(o.delayReason || 'delay noted') + '</div>' : ''}
    ${flagAccepted ? '<div class="meta" style="color:var(--danger);font-weight:600">⏰ waiting ' + ago(o.acceptedAt) + ' — follow up at laundry</div>' : ''}
    ${flagSoon ? '<div class="meta" style="color:var(--warn);font-weight:600">⏰ pickup soon — ' + (state.user?.role === 'laundry' ? 'check the lines' : 'prepare for pickup') + '</div>' : ''}
    ${flagPast && !flagSoon ? '<div class="meta" style="color:var(--muted)">pickup time passed</div>' : ''}
    <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap" onclick="event.stopPropagation()">
      ${o.status === 'new' && can('acceptOrders') ? `<button class="small" onclick="openAccept('${o.id}')">Accept</button>` : ''}
      ${o.status !== 'new' && unpaid && can('takePayment') ? `<button class="small secondary" onclick="takePayment('${o.id}')">Take payment</button>` : ''}
      ${nextBtn && can('advanceStatus') && !laundryBlocked ? `<button class="small" ${blockPickup ? 'disabled title="Collect payment first"' : ''} onclick="advance('${o.id}')">${nextBtn}</button>` : ''}
    </div>
  </div>`;
}
function paymentPref(o) {
  if (o.paymentTiming === 'now') return `pay now (${o.paymentMethod || 'cash'})`;
  return 'pay at pickup';
}
function paymentLabel(o) {
  if (o.paymentStatus === 'paid') return 'paid';
  if (o.paymentStatus === 'partial') return `partial (${money(o.amountPaid)}/${money(o.price)})`;
  return '⚠ unpaid';
}
// Room input: a dropdown of admin-defined rooms, or a free-text box if none are set.
function roomField(id, current) {
  const rooms = state.settings?.rooms || [];
  if (!rooms.length) return `<input id="${id}" placeholder="e.g. Duafe" value="${esc(current || '')}">`;
  const list = rooms.slice();
  if (current && !list.includes(current)) list.push(current);
  return `<select id="${id}"><option value="">— select room —</option>${list.map(r => `<option value="${esc(r)}" ${current === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>`;
}

window.openOrder = async (id) => {
  const o = await api('GET', `/orders/${id}`);
  // Viewing the order counts as reading any guest messages — stops the message ping.
  if ((o.messages || []).some(m => m.sender === 'guest' && !m.readByStaff)) {
    try { await api('POST', `/orders/${id}/read`); } catch {}
    state.pendingMsg = Math.max(0, (state.pendingMsg || 0) - (o.messages || []).filter(m => m.sender === 'guest' && !m.readByStaff).length);
  }
  const canModify = o.status === 'new' ? can('acceptOrders') : can('modifyAccepted');
  const logs = (o.logs || []).slice().reverse().map(l => `<div class="log"><b>${esc(l.actor)}</b> <span class="muted">(${esc(l.role)})</span> — ${esc(l.detail)}<br><span class="muted" style="font-size:11px">${fmt(l.at)}</span></div>`).join('');
  const msgs = (o.messages || []).map(m => `<div class="msg ${m.sender}"><div class="who">${m.sender === 'staff' ? esc(m.staffName || 'Reception') : esc(o.guestName)} · ${fmt(m.at)}</div>${esc(m.text)}</div>`).join('') || '<p class="muted">No messages.</p>';
  const nextBtn = { accepted: 'Start cleaning', cleaning: 'Mark ready', ready: 'Mark picked up' }[o.status];
  openModal(`
    <button class="ghost small close" onclick="closeModal()">✕ Close</button>
    <h3>Order #${o.number} <span class="badge b-${o.status}">${STATUS_LABEL[o.status]}</span></h3>
    <table class="data">
      <tr><td class="muted">Guest</td><td>${esc(o.guestName)}</td></tr>
      <tr><td class="muted">Email</td><td>${esc(o.guestEmail)}</td></tr>
      <tr><td class="muted">Room name</td><td>${esc(o.room || '—')}</td></tr>
      <tr><td class="muted">Items / loads</td><td>${o.items} / ${o.loads}</td></tr>
      <tr><td class="muted">Total</td><td>${money(o.price)}${o.discount ? ` <span class="muted">(${esc(o.discount.code)} −${money(o.discount.amount)} off ${money(o.listPrice)})</span>` : ''}</td></tr>
      <tr><td class="muted">Payment</td><td>${o.paymentStatus === 'paid' ? 'Paid ✓ (' + (o.paymentMethod || '') + ')' + (o.paidBy ? ' · by ' + esc(o.paidBy.name) : '') : o.paymentStatus === 'partial' ? `Partial · ${money(o.amountPaid)} of ${money(o.price)} · ${money(o.price - o.amountPaid)} due` : '⚠ Unpaid · guest chose ' + paymentPref(o)}</td></tr>
      <tr><td class="muted">Ready by</td><td>${fmt(o.pickupAt)}</td></tr>
      ${o.note ? `<tr><td class="muted">Note</td><td>${esc(o.note)}</td></tr>` : ''}
      ${o.delayReason ? `<tr><td class="muted">Delay reason</td><td>${esc(o.delayReason)}${isSnoozedO(o) ? ' <span class="pill">reminder muted</span>' : ''}</td></tr>` : ''}
      ${attributionRows(o)}
    </table>
    <div id="modalMsg"></div>
    <div class="stack" style="margin-top:12px">
      ${o.status === 'new' && can('acceptOrders') ? `<button onclick="openAccept('${o.id}')">Accept order…</button>` : ''}
      ${o.status !== 'new' && o.paymentStatus !== 'paid' && can('takePayment') ? `<button onclick="takePayment('${o.id}')">Take payment${o.paymentStatus === 'partial' ? ` (${money(o.price - o.amountPaid)} due)` : ''}</button>` : ''}
      ${nextBtn && can('advanceStatus') && !(o.status === 'ready' && state.user?.role === 'laundry') ? (o.status === 'ready' && o.paymentStatus !== 'paid'
          ? `<button disabled title="Collect payment first">${nextBtn} — collect payment first</button>`
          : `<button onclick="advance('${o.id}', true)">${nextBtn}</button>`) : ''}
      ${['accepted', 'cleaning', 'ready'].includes(o.status) && can('advanceStatus') ? `<button class="secondary" onclick="reportDelay('${o.id}')">🔕 Report a delay (mute reminder 30 min)</button>` : ''}
      ${REVERSE_LABEL[o.status] && can('reverseStatus') ? `<button class="secondary" onclick="revert('${o.id}', true)">↩ Move back to ${REVERSE_LABEL[o.status]}</button>` : ''}
      ${o.status !== 'new' && canModify ? `<button class="secondary" onclick="openModify('${o.id}')">Edit order</button>` : ''}
      ${o.status !== 'new' && o.status !== 'completed' && o.status !== 'cancelled' && !canModify ? `<p class="muted" style="font-size:13px">Only an admin can edit an accepted order.</p>` : ''}
      ${!['completed', 'cancelled'].includes(o.status) && can('cancelOrders') ? `<button class="danger" onclick="cancelOrder('${o.id}')">Cancel order</button>` : ''}
    </div>
    <h3 style="margin-top:20px">Messages</h3>
    <div class="thread">${msgs}</div>
    ${can('messageGuests') ? `<form onsubmit="return replyOrder(event,'${o.id}')" style="display:flex;gap:8px;margin-top:10px"><input id="replyInput" placeholder="Reply to guest…" style="flex:1" required><button class="small">Send</button></form>` : ''}
    <h3 style="margin-top:20px">Activity log</h3>
    <div style="max-height:220px;overflow:auto">${logs || '<p class="muted">No activity.</p>'}</div>
  `);
};

window.openAccept = async (id) => {
  const o = (window._orders || []).find(x => x.id === id) || await api('GET', `/orders/${id}`);
  const est = (o.loads || 1) * (state.settings?.pricePerLoad || 0);
  const _pk = new Date(); _pk.setDate(_pk.getDate() + 1); _pk.setHours(18, 0, 0, 0);
  const pickupDefault = toLocalInput(_pk.toISOString());
  openModal(`
    <button class="ghost small close" onclick="closeModal()">✕</button>
    <h3>Accept order #${o.number}</h3>
    <p class="hint">${esc(o.guestName)} · ${o.items} items · ${o.loads} load(s)</p>
    <div id="acceptMsg"></div>
    <label>Room name${state.settings?.requireRoomOnAccept ? ' <span style="color:var(--danger)">*</span>' : ''}</label>
    ${roomField('acRoom', o.room)}
    <label>Ready for pickup</label>
    <input id="acPickup" type="datetime-local" value="${pickupDefault}">
    <p class="muted" style="font-size:12px;margin:6px 0 0">Defaults to 6:00 PM tomorrow — adjust if needed.</p>
    <label>Price (${cur()})</label>
    <input id="acPrice" type="number" step="0.01" min="0" value="${est.toFixed(2)}">
    <p class="muted" style="font-size:12px;margin:6px 0 0">${o.loads} load(s) × ${money(state.settings?.pricePerLoad)} = ${money(est)} (editable).</p>
    <label>Reason for price change <span class="muted">(required only if you change the amount)</span></label>
    <input id="acPriceReason" placeholder="e.g. express service / extra items">
    ${discountField('ac', null)}
    <label>Payment <span class="muted">— guest chose ${paymentPref(o)}</span></label>
    <select id="acPayStatus" onchange="document.getElementById('acMethodRow').style.display=this.value==='paid'?'block':'none'">
      <option value="unpaid" ${o.paymentTiming !== 'now' ? 'selected' : ''}>Not paid yet</option>
      <option value="paid" ${o.paymentTiming === 'now' ? 'selected' : ''}>Collect payment now</option>
    </select>
    <div id="acMethodRow" style="display:${o.paymentTiming === 'now' ? 'block' : 'none'}">
      <label>Method</label>
      <select id="acMethod"><option value="cash" ${o.paymentMethod !== 'card' ? 'selected' : ''}>Cash</option><option value="card" ${o.paymentMethod === 'card' ? 'selected' : ''}>Card</option></select>
    </div>
    <button class="btn-full" style="margin-top:16px" onclick="doAccept('${o.id}')">Accept & notify guest</button>
  `);
};
window.doAccept = async (id) => {
  const room = ($('#acRoom').value || '').trim();
  if (state.settings?.requireRoomOnAccept && !room) return notice($('#acceptMsg'), 'err', 'Please select a room before accepting.');
  try {
    const pickup = $('#acPickup').value ? new Date($('#acPickup').value).toISOString() : null;
    await api('POST', `/orders/${id}/accept`, {
      room, pickupAt: pickup, price: $('#acPrice').value,
      priceReason: $('#acPriceReason').value.trim(),
      discountCode: $('#acDiscount') ? $('#acDiscount').value : '',
      paymentStatus: $('#acPayStatus').value, paymentMethod: $('#acMethod') ? $('#acMethod').value : 'cash',
    });
    closeModal(); renderTab();
  } catch (e) { notice($('#acceptMsg'), 'err', e.message); }
};

window.openModify = async (id) => {
  const o = await api('GET', `/orders/${id}`);
  openModal(`
    <button class="ghost small close" onclick="closeModal()">✕</button>
    <h3>Edit order #${o.number}</h3>
    <div id="modMsg"></div>
    <label>Room name</label>${roomField('mdRoom', o.room)}
    <label>Items</label><input id="mdItems" type="number" min="1" value="${o.items}">
    <label>Price (${cur()})</label><input id="mdPrice" type="number" step="0.01" min="0" value="${o.price ?? ''}">
    <label>Reason for price change <span class="muted">(required if you change the price)</span></label>
    <input id="mdPriceReason" placeholder="e.g. added express service / extra items">
    <label>Ready by</label><input id="mdPickup" type="datetime-local" value="${o.pickupAt ? toLocalInput(o.pickupAt) : ''}">
    <label>Payment</label>
    <select id="mdPayStatus" onchange="document.getElementById('mdMethodRow').style.display=this.value==='paid'?'block':'none'">
      <option value="unpaid" ${o.paymentStatus !== 'paid' ? 'selected' : ''}>Pay at pickup</option>
      <option value="paid" ${o.paymentStatus === 'paid' ? 'selected' : ''}>Paid</option>
    </select>
    <div id="mdMethodRow" style="display:${o.paymentStatus === 'paid' ? 'block' : 'none'}">
      <label>Method</label>
      <select id="mdMethod"><option value="cash" ${o.paymentMethod === 'cash' ? 'selected' : ''}>Cash</option><option value="card" ${o.paymentMethod === 'card' ? 'selected' : ''}>Card</option></select>
    </div>
    ${discountField('md', o.discount)}
    ${(Number(o.amountPaid) || 0) > 0 ? `<label>Payment date</label><input id="mdPaidAt" type="datetime-local" value="${o.paidAt ? toLocalInput(o.paidAt) : ''}"><p class="muted" style="font-size:12px;margin:6px 0 0">Corrects the date this order's payment was recorded.</p>` : ''}
    <button class="btn-full" style="margin-top:16px" onclick="doModify('${o.id}')">Save changes</button>
  `);
};
window.doModify = async (id) => {
  try {
    await api('PATCH', `/orders/${id}`, {
      room: $('#mdRoom').value.trim(), items: $('#mdItems').value, price: $('#mdPrice').value,
      priceReason: $('#mdPriceReason').value.trim(),
      paidAt: $('#mdPaidAt') && $('#mdPaidAt').value ? new Date($('#mdPaidAt').value).toISOString() : undefined,
      pickupAt: $('#mdPickup').value ? new Date($('#mdPickup').value).toISOString() : undefined,
      paymentStatus: $('#mdPayStatus').value, paymentMethod: $('#mdMethod').value,
      ...discountPatch('md'),
    });
    closeModal(); renderTab();
  } catch (e) { notice($('#modMsg'), 'err', e.message); }
};

window.advance = async (id, close) => {
  try { await api('POST', `/orders/${id}/advance`, {}); if (close) closeModal(); renderTab(); }
  catch (e) {
    // A stale re-click on an order that's already picked up shouldn't alarm anyone.
    if (/already been picked up|already .*cancelled/i.test(e.message)) { if (close) closeModal(); renderTab(); }
    else alert(e.message);
  }
};
window.cancelOrder = async (id) => { const reason = prompt('Reason for cancelling (optional):'); if (reason === null) return; try { await api('POST', `/orders/${id}/cancel`, { reason }); closeModal(); renderTab(); } catch (e) { alert(e.message); } };
window.revert = async (id, close) => { if (!confirm('Move this order back one stage?')) return; try { await api('POST', `/orders/${id}/revert`, {}); if (close) closeModal(); renderTab(); } catch (e) { alert(e.message); } };
window.reportDelay = async (id) => {
  const reason = prompt('Reason for the delay (this mutes the reminder for 30 minutes, then it resumes if the order still hasn\'t moved):');
  if (reason === null || !reason.trim()) return;
  try { await api('POST', `/orders/${id}/delay-reason`, { reason: reason.trim() }); state._lastFollowUpPing = Date.now(); closeModal(); renderTab(); }
  catch (e) { alert(e.message); }
};
window.takePayment = async (id) => {
  const o = await api('GET', `/orders/${id}`);
  const paidSoFar = Number(o.amountPaid) || 0;
  const remaining = Math.max(0, round2m((Number(o.price) || 0) - paidSoFar));
  const partial = can('partialPayment');
  openModal(`
    <button class="ghost small close" onclick="closeModal()">✕</button>
    <h3>Take payment · #${o.number}</h3>
    <p class="hint">${esc(o.guestName)} · total ${money(o.price)}${paidSoFar > 0 ? ` · already paid ${money(paidSoFar)}` : ''} · <b>${money(remaining)} due</b></p>
    <div id="payMsg"></div>
    <label>Amount (${cur()})</label>
    <input id="payAmount" type="number" step="0.01" min="0" max="${remaining}" value="${remaining.toFixed(2)}" ${partial ? '' : 'readonly'}>
    <p class="muted" style="font-size:12px;margin:6px 0 0">${partial ? `Enter less than ${money(remaining)} to record a partial payment.` : 'Full amount only — partial payments require permission.'}</p>
    <label>Payment method</label>
    <div class="choice">
      <label><input type="radio" name="paym" value="cash" ${o.paymentMethod !== 'card' ? 'checked' : ''} /><span>Cash</span></label>
      <label><input type="radio" name="paym" value="card" ${o.paymentMethod === 'card' ? 'checked' : ''} /><span>Card</span></label>
    </div>
    <button class="btn-full" style="margin-top:16px" onclick="doPay('${o.id}')">Record payment</button>
  `);
};
function round2m(n) { return Math.round((Number(n) || 0) * 100) / 100; }
window.doPay = async (id) => {
  try {
    const method = document.querySelector('input[name="paym"]:checked').value;
    const amount = $('#payAmount') ? $('#payAmount').value : '';
    await api('POST', `/orders/${id}/pay`, { amount, method });
    closeModal(); await refreshShift(); renderTab();
  } catch (e) { notice($('#payMsg'), 'err', e.message); }
};
window.replyOrder = async (e, id) => { e.preventDefault(); const t = $('#replyInput').value.trim(); if (!t) return false; try { await api('POST', `/orders/${id}/reply`, { text: t }); openOrder(id); } catch (err) { notice($('#modalMsg'), 'err', err.message); } return false; };

// ---------------- MESSAGES ----------------
async function renderMessages(view, silent) {
  const threads = await api('GET', '/threads');
  const totalUnread = threads.reduce((a, t) => a + t.unread, 0);
  state.pendingMsg = totalUnread;
  setBadge('messages', totalUnread);
  view.innerHTML = `<h2>Guest messages ${totalUnread ? `<span class="pill">${totalUnread} unread</span>` : ''}</h2>
    <div class="grid">${threads.map(t => `
      <div class="ocard" onclick="openOrder('${t.id}')">
        <div class="top"><span class="num">#${t.number} · ${esc(t.guestName)}</span>${t.unread ? `<span class="tab-badge">${t.unread}</span>` : ''}</div>
        <div class="meta">${esc(t.lastMessage.sender === 'staff' ? 'You: ' : '')}${esc(t.lastMessage.text)}</div>
        <div class="meta">${fmt(t.lastMessage.at)} · <span class="badge b-${t.status}">${STATUS_LABEL[t.status]}</span></div>
      </div>`).join('') || '<p class="muted">No messages yet.</p>'}</div>`;
}
function setBadge(tab, n) { const b = $('#badge-' + tab); if (!b) return; if (n > 0) { b.textContent = n; b.classList.remove('hidden'); } else b.classList.add('hidden'); }

// ---------------- REPORTS ----------------
async function renderReports(view) {
  const today = new Date(); const p = n => String(n).padStart(2, '0');
  const toStr = d => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  view.innerHTML = `<h2>Revenue reporting</h2>
    <div class="card">
      <div class="toolbar">
        <div><label>Quick range</label><select id="rpRange" onchange="applyRange()">
          <option value="today">Today</option>
          <option value="7">Last 7 days</option>
          <option value="15">Last 15 days</option>
          <option value="30">Last 30 days</option>
          <option value="month">This month</option>
          <option value="custom">Custom</option>
        </select></div>
        <div><label>From</label><input id="rpFrom" type="date" value="${toStr(today)}" onchange="onDateEdited()"></div>
        <div><label>To</label><input id="rpTo" type="date" value="${toStr(today)}" onchange="onDateEdited()"></div>
        <div><label>Shift</label><select id="rpShift">
          <option value="">All shifts</option>
          <option value="AM">AM (06–14)</option>
          <option value="PM">PM (14–22)</option>
          <option value="Night">Night (22–06)</option>
        </select></div>
        <button onclick="loadReport()">Run</button>
        ${can('exportReports') ? `<button class="secondary" onclick="exportCsv()">CSV</button><button class="secondary" onclick="exportPdf()">PDF</button>` : ''}
      </div>
    </div>
    <div id="reportBody"></div>`;
  loadReport();
}
// Quick-range presets set the From/To fields, then re-run the report.
window.applyRange = () => {
  const v = $('#rpRange').value;
  if (v === 'custom') return; // let the user pick dates by hand
  const p = n => String(n).padStart(2, '0');
  const toStr = d => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const today = new Date();
  let start = new Date(today);
  if (v === 'today') start = new Date(today);
  else if (v === 'month') start = new Date(today.getFullYear(), today.getMonth(), 1);
  else start.setDate(today.getDate() - (Number(v) - 1)); // last N days incl. today
  $('#rpFrom').value = toStr(start);
  $('#rpTo').value = toStr(today);
  loadReport();
};
// If the user edits a date directly, switch the preset to "Custom".
window.onDateEdited = () => { const r = $('#rpRange'); if (r) r.value = 'custom'; };
function reportParams() {
  return {
    from: new Date($('#rpFrom').value + 'T00:00:00').toISOString(),
    // .999 so a payment taken in the last second of the day still lands in range.
    to: new Date($('#rpTo').value + 'T23:59:59.999').toISOString(),
    shift: $('#rpShift') ? $('#rpShift').value : '',
  };
}
function reportQs() {
  const p = reportParams();
  let s = `from=${encodeURIComponent(p.from)}&to=${encodeURIComponent(p.to)}`;
  if (p.shift) s += `&shift=${encodeURIComponent(p.shift)}`;
  return s;
}
// ---------------- DISCOUNTS (shared bits) ----------------
// The codes a user may apply. Silently empty for anyone without the permission,
// so the picker simply doesn't appear for them.
async function loadDiscounts() {
  if (!can('discount')) { state.discounts = []; return; }
  try { state.discounts = await api('GET', '/discounts'); } catch { state.discounts = []; }
}
function usableDiscounts(currentCode) {
  return (state.discounts || []).filter(d => d.code === currentCode || (d.active && !d.expired && !d.spent));
}
function discountLabel(d) {
  const off = d.type === 'percent' ? `${d.value}% off` : `${money(d.value)} off`;
  return `${d.code} — ${off}${d.label ? ' · ' + d.label : ''}`;
}
// The picker shown in the accept and modify modals. Renders nothing at all when
// the user can't discount or there is no usable code to pick.
function discountField(prefix, current) {
  const list = usableDiscounts(current && current.code);
  if (!can('discount') || !list.length) return '';
  const opts = list.map(d => `<option value="${esc(d.code)}" ${current && current.code === d.code ? 'selected' : ''}>${esc(discountLabel(d))}</option>`).join('');
  return `<label>Discount</label>
    <select id="${prefix}Discount"><option value="">No discount</option>${opts}</select>
    ${current ? `<p class="muted" style="font-size:12px;margin:6px 0 0">Currently ${esc(current.code)} — ${money(current.amount)} off. Choose "No discount" to remove it.</p>` : ''}`;
}
// Turns the picker into the patch the API expects: a code to apply, or an
// explicit removal when an order that had one is set back to none.
function discountPatch(prefix) {
  const el = document.getElementById(`${prefix}Discount`);
  if (!el) return {};
  const code = el.value;
  return code ? { discountCode: code } : { removeDiscount: true };
}

window.toggleBd = (id) => { const el = document.getElementById(id); if (el) el.classList.toggle('hidden'); };
// The orders whose payments make up a shift's cash and card figures, so a total
// can be traced back to the individual payments behind it.
function methodBreakdown(b) {
  const line = (label, total, method) => {
    const list = (b.payments || []).filter(p => p.method === method);
    const items = list.map(p => `<span style="display:inline-block;margin:2px 10px 2px 0;white-space:nowrap">#${p.number} <b>${money(p.amount)}</b> <span class="muted">${String(p.at).slice(11, 16)}${p.by ? ' · ' + esc(p.by) : ''}</span></span>`).join('');
    return `<div style="margin:4px 0"><span class="muted">↳ ${label}</span> <b>${money(total)}</b>${list.length ? ` <span class="muted">— ${list.length} payment${list.length > 1 ? 's' : ''}</span><div style="margin:2px 0 0 14px;font-size:12px">${items}</div>` : ' <span class="muted">— none</span>'}</div>`;
  };
  return line('Cash', b.cash, 'cash') + line('Card', b.card, 'card');
}
window.loadReport = async () => {
  const p = reportParams();
  const r = await api('GET', '/report?' + reportQs());
  window._report = r;
  const t = r.totals;
  const maxRev = Math.max(1, ...r.byDay.map(d => d.revenue));
  $('#reportBody').innerHTML = `
    ${r.range.shift && r.range.shift !== 'all' ? `<p class="hint" style="margin:0 0 12px">Showing <b>${r.range.shift}</b> shift only (${SHIFT_TIME[r.range.shift]}).</p>` : ''}
    <div class="stats">
      <div class="stat"><div class="k">Revenue</div><div class="v">${money(t.revenue)}</div></div>
      <div class="stat"><div class="k">Collected</div><div class="v">${money(t.collected)}</div></div>
      <div class="stat"><div class="k">Outstanding</div><div class="v">${money(t.outstanding)}</div></div>
      <div class="stat"><div class="k">Orders</div><div class="v">${t.orders}</div></div>
      <div class="stat"><div class="k">Loads</div><div class="v">${t.loads}</div></div>
      <div class="stat"><div class="k">Items</div><div class="v">${t.items}</div></div>
      <div class="stat"><div class="k">Avg order</div><div class="v">${money(t.avgOrderValue)}</div></div>
      <div class="stat"><div class="k">Cash / Card</div><div class="v" style="font-size:18px">${money(r.byMethod.cash)} / ${money(r.byMethod.card)}</div></div>
      ${t.discounts ? `<div class="stat"><div class="k">Discounts</div><div class="v">-${money(t.discounts)}</div><div class="muted" style="font-size:11px">${t.discountedCount} order(s)</div></div>` : ''}
    </div>
    <div class="card"><h3 style="margin-top:0">Revenue by day</h3>
      ${r.byDay.length ? r.byDay.map(d => `<div style="display:flex;align-items:center;gap:10px;margin:6px 0">
        <span class="muted" style="width:96px;font-size:12px">${d.date}</span>
        <div style="flex:1;background:#eef2f5;border-radius:6px;height:20px;overflow:hidden"><div style="width:${(d.revenue / maxRev * 100).toFixed(1)}%;background:var(--accent);height:100%"></div></div>
        <span style="width:90px;text-align:right;font-size:13px">${money(d.revenue)}</span>
      </div>`).join('') : '<p class="muted">No revenue in this range.</p>'}
    </div>
    <div class="card"><h3 style="margin-top:0">By shift</h3>
      <p class="hint" style="margin-top:-4px">Revenue &amp; loads count orders <b>accepted</b> in each shift. Collected counts money <b>received</b> during the shift — tap it to see the cash / card split and the orders behind each.</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>Shift</th><th>Orders</th><th>Loads</th><th>Revenue</th><th>Collected</th></tr></thead>
      <tbody>${['AM', 'PM', 'Night'].map(s => { const b = r.byShift[s]; return `<tr><td><b>${s}</b> <span class="muted">${SHIFT_TIME[s]}</span></td><td>${b.orders}</td><td>${b.loads}</td><td>${money(b.revenue)}</td><td><button onclick="toggleBd('bd-${s}')" style="background:none;border:0;color:var(--accent);padding:0;cursor:pointer;font:inherit;text-decoration:underline">${money(b.collected)} ▾</button></td></tr>
      <tr id="bd-${s}" class="hidden"><td colspan="5" style="padding-left:20px">${methodBreakdown(b)}</td></tr>`; }).join('')}</tbody></table></div>
    </div>
    <div class="card"><h3 style="margin-top:0">By staff</h3>
      <p class="hint" style="margin-top:-4px">Payments / Collected / Cash / Card count the money each person <b>took</b> in this range, by payment time — regardless of when the order was accepted.</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>Staff</th><th>Accepted</th><th>Cleaned</th><th>Ready</th><th>Picked up</th><th>Payments</th><th>Collected</th><th>Cash</th><th>Card</th></tr></thead>
      <tbody>${(r.byStaff || []).map(s => `<tr><td>${esc(s.name)}</td><td>${s.accepted}</td><td>${s.cleaned}</td><td>${s.ready}</td><td>${s.completed}</td><td>${s.payments}</td><td>${money(s.collected)}</td><td>${money(s.cash)}</td><td>${money(s.card)}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">No activity</td></tr>'}</tbody></table></div>
    </div>
    <div class="card"><h3 style="margin-top:0">Orders in range (${r.orders.length})</h3>
      <div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Date</th><th>Shift</th><th>Guest</th><th>Room</th><th>Loads</th><th>Total</th><th>Discount</th><th>Payment</th><th>Accepted</th><th>Ready</th><th>Paid by</th><th>Status</th></tr></thead>
      <tbody>${r.orders.map(o => `<tr><td>#${o.number}</td><td>${fmt(o.acceptedAt || o.createdAt)}</td><td>${o.shift}</td><td>${esc(o.guestName)}</td><td>${esc(o.room || '—')}</td><td>${o.loads}</td><td>${money(o.price)}</td><td>${o.discount ? esc(o.discount.code) + ' −' + money(o.discount.amount) : '—'}</td><td>${o.paymentStatus === 'paid' ? 'Paid (' + (o.paymentMethod || '') + ')' : 'Unpaid'}</td><td>${esc(nm(o.acceptedBy))}</td><td>${esc(nm(o.readyBy))}</td><td>${esc(nm(o.paidBy))}</td><td><span class="badge b-${o.status}">${STATUS_LABEL[o.status]}</span></td></tr>`).join('') || '<tr><td colspan="13" class="muted">None</td></tr>'}</tbody></table></div>
    </div>
    <div id="shiftHistory"></div>`;
  loadShiftHistory(p.from, p.to);
};
async function loadShiftHistory(from, to) {
  let shifts = [];
  try { shifts = await api('GET', `/shifts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); } catch { return; }
  if (!shifts.length) return;
  $('#shiftHistory').innerHTML = `<div class="card"><h3 style="margin-top:0">Shift handover history</h3>
    <div class="table-wrap"><table class="data"><thead><tr><th>Opened</th><th>Cashier</th><th>Shift</th><th>Closed</th><th>Received</th><th>Paid</th><th>Picked up</th><th>In progress</th><th>Area checked</th><th>Status</th></tr></thead>
    <tbody>${shifts.map(s => { const a = s.activity || {}; return `<tr><td>${fmt(s.openedAt)}</td><td>${esc(s.cashierName)}</td><td>${s.type}</td><td>${s.closedAt ? fmt(s.closedAt) : '—'}</td><td>${a.received ? a.received.count : '—'}</td><td>${a.payments ? money(a.payments.total) : '—'}</td><td>${a.pickedUp ? a.pickedUp.count : '—'}</td><td>${s.closingInProgress != null ? s.closingInProgress : '—'}</td><td>${s.acknowledged ? '✓' : '—'}</td><td>${s.status === 'open' ? '<span class="pill">open</span>' : 'closed'}</td></tr>`; }).join('')}</tbody></table></div></div>`;
}
const SHIFT_TIME = { AM: '06:00–14:00', PM: '14:00–22:00', Night: '22:00–06:00' };
function hourOptions(sel) {
  let out = '';
  for (let h = 0; h < 24; h++) {
    const label = h === 0 ? '12 AM (midnight)' : h < 12 ? `${h} AM` : h === 12 ? '12 PM (noon)' : `${h - 12} PM`;
    out += `<option value="${h}" ${Number(sel) === h ? 'selected' : ''}>${label}</option>`;
  }
  return out;
}
function nm(ref) { return ref && ref.name ? ref.name : '—'; }
window.exportCsv = async () => {
  const res = await fetch('/api/report/csv?' + reportQs(), { headers: { authorization: `Bearer ${state.token}` } });
  const blob = await res.blob();
  const shiftTag = $('#rpShift') && $('#rpShift').value ? '_' + $('#rpShift').value : '';
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `revenue-${$('#rpFrom').value}_to_${$('#rpTo').value}${shiftTag}.csv`; a.click();
};
window.exportPdf = () => {
  const r = window._report; if (!r) return;
  const t = r.totals; const name = esc(state.settings?.hostelName || 'Laundry');
  const w = window.open('', '_blank');
  w.document.write(`<html><head><title>Revenue Report</title><style>
    body{font-family:Arial,sans-serif;color:#222;padding:30px;max-width:760px;margin:auto}
    h1{color:${state.settings?.accentColor || '#0f766e'}} table{width:100%;border-collapse:collapse;margin:12px 0}
    td,th{border:1px solid #ddd;padding:7px 9px;text-align:left;font-size:13px} th{background:#f4f6f8}
    .kv{display:flex;flex-wrap:wrap;gap:8px}.kv div{border:1px solid #eee;border-radius:8px;padding:10px 14px;min-width:120px}
    .kv b{display:block;font-size:20px}</style></head><body>
    <h1>${name} — Revenue Report</h1>
    <p>${$('#rpFrom').value} to ${$('#rpTo').value}${r.range.shift && r.range.shift !== 'all' ? ' · ' + r.range.shift + ' shift only' : ''}</p>
    <div class="kv">
      <div>Revenue<b>${money(t.revenue)}</b></div><div>Collected<b>${money(t.collected)}</b></div>
      <div>Outstanding<b>${money(t.outstanding)}</b></div><div>Orders<b>${t.orders}</b></div>
      <div>Loads<b>${t.loads}</b></div><div>Avg order<b>${money(t.avgOrderValue)}</b></div>
      <div>Cash<b>${money(r.byMethod.cash)}</b></div><div>Card<b>${money(r.byMethod.card)}</b></div>
      ${t.discounts ? `<div>Discounts<b>-${money(t.discounts)}</b></div>` : ''}
    </div>
    <h3>Daily</h3><table><tr><th>Date</th><th>Orders</th><th>Loads</th><th>Revenue</th></tr>
    ${r.byDay.map(d => `<tr><td>${d.date}</td><td>${d.orders}</td><td>${d.loads}</td><td>${money(d.revenue)}</td></tr>`).join('')}</table>
    <h3>By shift</h3><table><tr><th>Shift</th><th>Orders</th><th>Loads</th><th>Revenue</th><th>Collected</th><th>Cash</th><th>Card</th></tr>
    ${['AM', 'PM', 'Night'].map(s => { const b = r.byShift[s]; return `<tr><td>${s} (${SHIFT_TIME[s]})</td><td>${b.orders}</td><td>${b.loads}</td><td>${money(b.revenue)}</td><td>${money(b.collected)}</td><td>${money(b.cash)}</td><td>${money(b.card)}</td></tr>`; }).join('')}</table>
    <h3>Payments behind each shift total</h3><table><tr><th>Shift</th><th>Time</th><th>Order</th><th>Method</th><th>Amount</th><th>Taken by</th></tr>
    ${['AM', 'PM', 'Night'].flatMap(s => (r.byShift[s].payments || []).map(p => `<tr><td>${s}</td><td>${String(p.at).slice(11, 16)}</td><td>#${p.number}</td><td>${p.method}</td><td>${money(p.amount)}</td><td>${esc(p.by || 'Unattributed')}</td></tr>`)).join('') || '<tr><td colspan="6">No payments in this range.</td></tr>'}</table>
    <h3>By staff</h3><table><tr><th>Staff</th><th>Accepted</th><th>Cleaned</th><th>Ready</th><th>Picked up</th><th>Payments</th><th>Collected</th><th>Cash</th><th>Card</th></tr>
    ${(r.byStaff || []).map(s => `<tr><td>${esc(s.name)}</td><td>${s.accepted}</td><td>${s.cleaned}</td><td>${s.ready}</td><td>${s.completed}</td><td>${s.payments}</td><td>${money(s.collected)}</td><td>${money(s.cash)}</td><td>${money(s.card)}</td></tr>`).join('')}</table>
    <h3>Orders</h3><table><tr><th>#</th><th>Shift</th><th>Guest</th><th>Room</th><th>Loads</th><th>Total</th><th>Discount</th><th>Payment</th><th>Accepted by</th><th>Paid by</th></tr>
    ${r.orders.map(o => `<tr><td>${o.number}</td><td>${o.shift}</td><td>${esc(o.guestName)}</td><td>${esc(o.room || '')}</td><td>${o.loads}</td><td>${money(o.price)}</td><td>${o.discount ? esc(o.discount.code) + ' -' + money(o.discount.amount) : ''}</td><td>${o.paymentStatus}</td><td>${esc(nm(o.acceptedBy))}</td><td>${esc(nm(o.paidBy))}</td></tr>`).join('')}</table>
    <p style="color:#888;font-size:12px;margin-top:20px">Generated ${new Date().toLocaleString()}</p>
    <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
};

// ---------------- CASHIERS ----------------
async function renderCashiers(view) {
  const list = await api('GET', '/cashiers');
  view.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><h2>Cashiers & access levels</h2><button onclick="openCashier()">+ Add cashier</button></div>
    <div class="grid" style="margin-top:12px">${list.map(c => `
      <div class="card" style="margin:0">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><b>${esc(c.name)}</b> <span class="pill">${c.role}</span> ${c.active ? '' : '<span class="badge b-cancelled">inactive</span>'}</div>
        </div>
        ${c.email ? `<div class="muted" style="font-size:12px;margin-top:4px">${esc(c.email)}</div>` : ''}
        <div class="muted" style="font-size:13px;margin:8px 0">${c.role === 'admin' ? 'Full access to everything.' : (Object.entries(c.permissions).filter(([, v]) => v).map(([k]) => state.catalogue[k] || k).join(', ') || 'No permissions set')}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="small secondary" onclick='openCashier(${JSON.stringify(c)})'>Edit</button>
        <button class="small" onclick='openInvite(${JSON.stringify(c)})'>✉ Invite</button>
        <button class="small danger" onclick="delCashier('${c.id}','${esc(c.name)}')">Remove</button></div>
      </div>`).join('')}</div>`;
}
window.openCashier = (c) => {
  c = c || null;
  const perms = state.catalogue;
  const checks = Object.entries(perms).map(([k, label]) => `<label style="font-weight:400;display:flex;gap:8px;align-items:center;margin:4px 0"><input type="checkbox" data-perm="${k}" style="width:auto" ${c && c.permissions && c.permissions[k] ? 'checked' : ''}> ${esc(label)}</label>`).join('');
  openModal(`
    <button class="ghost small close" onclick="closeModal()">✕</button>
    <h3>${c ? 'Edit' : 'Add'} cashier</h3>
    <div id="cshMsg"></div>
    <label>Name</label><input id="cshName" value="${c ? esc(c.name) : ''}">
    <label>Email <span class="muted">(optional — for invitations)</span></label><input id="cshEmail" type="email" value="${c ? esc(c.email || '') : ''}" placeholder="name@example.com">
    <label>Role</label>
    <select id="cshRole" onchange="onRoleChange(this.value)">
      <option value="cashier" ${c && c.role === 'cashier' ? 'selected' : ''}>Cashier (reception)</option>
      <option value="laundry" ${c && c.role === 'laundry' ? 'selected' : ''}>Laundry person (cleaning → ready)</option>
      <option value="admin" ${c && c.role === 'admin' ? 'selected' : ''}>Admin (full access)</option>
    </select>
    <label>PIN ${c ? '(leave blank to keep current)' : '(4–8 digits)'}</label>
    <input id="cshPin" inputmode="numeric" maxlength="8" placeholder="${c ? '••••' : 'e.g. 4821'}">
    <div id="permBox" style="display:${c && c.role === 'admin' ? 'none' : 'block'};margin-top:10px">
      <label>Permissions</label>
      <div style="background:#f9fafb;border-radius:10px;padding:10px 14px">${checks}</div>
    </div>
    ${c ? `<label style="display:flex;gap:8px;align-items:center;margin-top:10px;font-weight:400"><input type="checkbox" id="cshActive" style="width:auto" ${c.active ? 'checked' : ''}> Active</label>` : ''}
    <button class="btn-full" style="margin-top:16px" onclick="saveCashier(${c ? `'${c.id}'` : 'null'})">Save</button>
  `);
  if (!c) onRoleChange('cashier'); // seed default permissions for a new staff member
};
const ROLE_DEFAULTS = {
  cashier: { acceptOrders: true, advanceStatus: true, takePayment: true, messageGuests: true },
  laundry: { advanceStatus: true },
  admin: {},
};
window.onRoleChange = (role) => {
  const box = document.getElementById('permBox');
  if (box) box.style.display = role === 'admin' ? 'none' : 'block';
  const defs = ROLE_DEFAULTS[role] || {};
  document.querySelectorAll('[data-perm]').forEach((cb) => { cb.checked = !!defs[cb.dataset.perm]; });
};
window.saveCashier = async (id) => {
  const role = $('#cshRole').value;
  const permissions = {};
  document.querySelectorAll('[data-perm]').forEach(cb => permissions[cb.dataset.perm] = cb.checked);
  const body = { name: $('#cshName').value.trim(), email: $('#cshEmail').value.trim(), role, permissions };
  const pin = $('#cshPin').value.trim(); if (pin) body.pin = pin;
  if ($('#cshActive')) body.active = $('#cshActive').checked;
  try {
    if (id) await api('PATCH', `/cashiers/${id}`, body);
    else { if (!pin) throw new Error('A PIN is required for a new cashier.'); await api('POST', '/cashiers', body); }
    closeModal(); renderCashiers($('#view'));
  } catch (e) { notice($('#cshMsg'), 'err', e.message); }
};
window.delCashier = async (id, name) => { if (!confirm(`Remove ${name}?`)) return; try { await api('DELETE', `/cashiers/${id}`); renderCashiers($('#view')); } catch (e) { alert(e.message); } };
window.openInvite = (c) => {
  openModal(`
    <button class="ghost small close" onclick="closeModal()">✕</button>
    <h3>Invite ${esc(c.name)}</h3>
    <p class="hint">Sends a branded email with a link to the app and ${esc(c.name)}'s PIN (${c.role === 'admin' ? 'full Administrator access' : 'Cashier access'}). Enter their current PIN so it can be included — we verify it first.</p>
    <div id="invMsg"></div>
    <label>Email address</label>
    <input id="invEmail" type="email" value="${esc(c.email || '')}" placeholder="name@example.com">
    <label>${esc(c.name)}'s current PIN</label>
    <input id="invPin" inputmode="numeric" maxlength="8" placeholder="e.g. 4821">
    <button class="btn-full" style="margin-top:16px" onclick="doInvite('${c.id}')">Send invitation</button>
  `);
};
window.doInvite = async (id) => {
  try {
    const r = await api('POST', `/cashiers/${id}/invite`, { email: $('#invEmail').value.trim(), pin: $('#invPin').value.trim() });
    notice($('#invMsg'), r.dryRun ? 'info' : 'ok', r.dryRun
      ? `Invitation prepared for ${r.sentTo}. Email isn't configured yet, so it was logged but not delivered — set up email to send for real.`
      : `Invitation sent to ${r.sentTo}. ✓`);
    setTimeout(() => { closeModal(); renderCashiers($('#view')); }, 1600);
  } catch (e) { notice($('#invMsg'), 'err', e.message); }
};

// ---------------- SETTINGS ----------------
const CURRENCIES = [
  ['USD', '$'], ['EUR', '€'], ['GBP', '£'], ['JPY', '¥'], ['AUD', 'A$'], ['CAD', 'C$'], ['CHF', 'CHF'],
  ['CNY', '¥'], ['INR', '₹'], ['NGN', '₦'], ['GHS', '₵'], ['ZAR', 'R'], ['KES', 'KSh'], ['BRL', 'R$'],
  ['MXN', '$'], ['SGD', 'S$'], ['HKD', 'HK$'], ['NZD', 'NZ$'], ['SEK', 'kr'], ['NOK', 'kr'], ['DKK', 'kr'],
  ['PLN', 'zł'], ['THB', '฿'], ['IDR', 'Rp'], ['PHP', '₱'], ['AED', 'د.إ'], ['SAR', '﷼'], ['TRY', '₺'],
];
async function renderSettings(view) {
  const s = state.settings = await api('GET', '/settings');
  const seq = await api('GET', '/sequence').catch(() => ({ next: '—' }));
  const staffList = await api('GET', '/cashiers').catch(() => []);
  const orderUrl = (s.baseUrl || location.origin) + '/order';
  view.innerHTML = `<h2>Settings</h2>
    <div id="setMsg"></div>
    <div class="card">
      <h3 style="margin-top:0">Branding</h3>
      <label>Hostel / property name</label><input id="stName" value="${esc(s.hostelName || '')}">
      <div class="row">
        <div><label>Accent colour</label><input id="stColor" type="color" value="${s.accentColor || '#0f766e'}" style="height:44px"></div>
        <div><label>Hover highlight colour</label><input id="stHover" type="color" value="${(s.hoverColor || '#FFF8ED').toLowerCase()}" style="height:44px"></div>
      </div>
      <label>Logo</label>
      <div style="display:flex;gap:12px;align-items:center">
        <img id="logoPreview" src="${s.logoDataUrl || ''}" style="max-height:46px;${s.logoDataUrl ? '' : 'display:none'}">
        <input id="stLogo" type="file" accept="image/*" onchange="previewLogo(this)">
        ${s.logoDataUrl ? '<button class="small secondary" onclick="clearLogo()">Remove</button>' : ''}
      </div>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Rooms</h3>
      <p class="hint">Room names cashiers pick from when accepting an order — one per line. Leave empty to let them type room names freely.</p>
      <textarea id="stRooms" rows="4" placeholder="Duafe&#10;Sankofa&#10;Adinkra">${esc((s.rooms || []).join('\n'))}</textarea>
      <div id="roomsMsg"></div>
      <button class="secondary" style="margin-top:10px" onclick="saveRooms()">Save rooms</button>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Required fields</h3>
      <p class="hint">Guest name, number of items and payment choice are always required. Toggle the optional ones below (saved with "Save settings").</p>
      <label style="display:flex;gap:9px;align-items:center;font-weight:400"><input type="checkbox" id="stReqEmail" style="width:auto" ${s.requireEmail ? 'checked' : ''}> Guest must give an email when ordering</label>
      <label style="display:flex;gap:9px;align-items:center;font-weight:400;margin-top:8px"><input type="checkbox" id="stReqRoom" style="width:auto" ${s.requireRoomOnAccept ? 'checked' : ''}> Room must be selected when accepting an order</label>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Pricing & loads</h3>
      <label>Currency</label>
      <select id="stCurrency">${CURRENCIES.map(([c, sym]) => `<option value="${c}|${sym}" ${s.currency?.code === c ? 'selected' : ''}>${c} (${sym})</option>`).join('')}</select>
      <div class="row">
        <div><label>Price per load</label><input id="stPrice" type="number" step="0.01" min="0" value="${s.pricePerLoad}"></div>
        <div><label>Max pieces per load</label><input id="stPieces" type="number" min="1" value="${s.piecesPerLoad}"></div>
      </div>
      <label>Standard turnaround (hours)</label><input id="stTurn" type="number" min="1" value="${s.turnaroundHours}">
    </div>
    <div class="card">
      <h3 style="margin-top:0">Follow-up reminders</h3>
      <p class="hint">Remind reception to follow up on accepted laundry that hasn't moved, and on orders past their pickup time. Reminders repeat until the order moves on, and pause during quiet hours.</p>
      <div class="row">
        <div><label>Follow up after order accepted (hours)</label><input id="stFollowUp" type="number" min="0.25" step="0.25" value="${s.followUpHours}"></div>
        <div><label>Repeat email/push reminder every (hours)</label><input id="stFollowEvery" type="number" min="0.25" step="0.25" value="${s.followUpEveryHours}"></div>
      </div>
      <label>Start pickup reminders this many hours before pickup time</label>
      <input id="stPickupLead" type="number" min="0" step="0.5" value="${s.pickupLeadHours}">
      <p class="muted" style="font-size:12px;margin:6px 0 0">No sound is played after the pickup time has passed — only before it.</p>
      <div class="row">
        <div><label>Quiet hours from</label>
          <select id="stQuietFrom">${hourOptions(s.quietFrom)}</select></div>
        <div><label>Quiet hours until</label>
          <select id="stQuietTo">${hourOptions(s.quietTo)}</select></div>
      </div>
      <p class="muted" style="font-size:12px;margin:6px 0 0">No reminders are sent during quiet hours; they resume afterwards for anything still outstanding.</p>
      <div class="row" style="margin-top:8px">
        <div><label>Admin alert email</label><input id="stAdminEmail" type="email" value="${esc(s.adminEmail || '')}"></div>
        <div><label>Reception alert email</label><input id="stRecEmail" type="email" value="${esc(s.receptionEmail || '')}"></div>
      </div>
      <label>Additional alert recipients <span class="muted">(comma or new-line separated)</span></label>
      <textarea id="stAlertRecipients" placeholder="manager@hostelaccra.com, owner@hostelaccra.com">${esc((s.alertRecipients || []).join(', '))}</textarea>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Ready-for-pickup alert</h3>
      <p class="hint">Email the admin (and any staff you tick below) when an order stays "ready for pickup" longer than the set time.</p>
      <label>Alert after ready for (hours)</label>
      <input id="stReadyStuck" type="number" min="0.25" step="0.25" value="${s.readyStuckHours}">
      <label>Also email these staff</label>
      <div style="background:#f9fafb;border:1px solid var(--line);border-radius:10px;padding:8px 12px">
        ${staffList.length ? staffList.map(c => `<label style="display:flex;gap:8px;align-items:center;font-weight:400;margin:4px 0;font-size:14px"><input type="checkbox" class="readyUser" value="${c.id}" style="width:auto" ${(s.readyAlertUserIds || []).includes(c.id) ? 'checked' : ''} ${c.email ? '' : 'disabled'}> ${esc(c.name)} <span class="muted">${c.email ? '(' + esc(c.email) + ')' : '— no email set'}</span></label>`).join('') : '<p class="muted" style="font-size:13px;margin:2px 0">No staff added yet.</p>'}
      </div>
      <p class="muted" style="font-size:12px;margin-top:6px">Staff need an email address (set it under Cashiers) to be selectable.</p>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Public site URL</h3>
      <label>Base URL (used in guest emails & QR)</label>
      <input id="stBase" placeholder="https://your-site.netlify.app" value="${esc(s.baseUrl || '')}">
      <p class="muted" style="font-size:12px">Leave blank to auto-use this site's address.</p>
    </div>
    <button class="btn-full" onclick="saveSettings()">Save settings</button>

    <div class="card" style="margin-top:20px;text-align:center">
      <h3 style="margin-top:0">Guest order QR code</h3>
      <p class="hint">Print this and place it at reception. Guests scan to order.</p>
      <div id="qrbox" style="display:inline-block;padding:12px;background:#fff;border-radius:12px"></div>
      <p class="muted" style="font-size:12px;word-break:break-all">${esc(orderUrl)}</p>
      <button class="small secondary" onclick="downloadQr()">Download QR</button>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Discounts</h3>
      <p class="hint">Codes reception can apply to an order. A code can be limited by an expiry date or a maximum number of uses, or simply switched off. Only staff with the <b>${esc(state.catalogue.discount || 'discount')}</b> permission can apply one.</p>
      <div id="discMsg"></div>
      <div id="discList"></div>
      <button class="secondary" style="margin-top:10px" onclick="openDiscount()">+ Issue a discount</button>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Repair payment records</h3>
      <p class="hint">Earlier versions of this app saved a payment as a status only — no amount, no cash/card ledger — so those payments are missing from reports. This rebuilds them from each order's own price, payment time and cashier. Preview first; nothing changes until you apply.</p>
      <div id="bfMsg"></div>
      <div id="bfResult"></div>
      <div class="toolbar" style="margin-top:8px">
        <button class="secondary" onclick="previewBackfill()">Preview changes</button>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Order numbering</h3>
      <p class="hint">The next order will be <b>#<span id="seqCurrent">${seq.next}</span></b>. Change the next number below (e.g. to restart the sequence).</p>
      <div id="seqMsg"></div>
      <div class="toolbar">
        <div><label>Next order number</label><input id="seqNext" type="number" min="1" placeholder="${seq.next}"></div>
        <button onclick="saveSequence()">Update</button>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Backup & restore</h3>
      <p class="hint">Download a full snapshot of everything (orders, staff, settings, shifts). Keep the file private — it includes login PIN hashes. Restore it later to recover your data.</p>
      <div id="bkMsg"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="secondary" onclick="downloadBackup()">⬇ Download backup</button>
        <label class="btn secondary" style="cursor:pointer;text-align:center">⬆ Restore from file…<input type="file" id="bkFile" accept="application/json,.json" style="display:none" onchange="restoreBackup(this)"></label>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Notification devices</h3>
      <p class="hint">Every device that enabled alerts receives order, message and follow-up notifications even when the app is closed. Tick a device to also push it the <b>"start a shift"</b> reminder when closed — leave others unticked so only chosen phones get that one.</p>
      <div id="devList" class="muted">Loading…</div>
    </div>

    <div class="card" style="margin-top:20px;border:1px solid #f0cfc9">
      <h3 style="margin-top:0;color:var(--danger)">Delete orders</h3>
      <p class="hint">Permanently remove all orders created within a date range. This cannot be undone.</p>
      <div id="delMsg"></div>
      <div class="row">
        <div><label>From</label><input id="delFrom" type="date"></div>
        <div><label>To</label><input id="delTo" type="date"></div>
      </div>
      <button class="danger" style="margin-top:14px" onclick="deleteOrdersRange()">Delete orders in range</button>
    </div>`;
  drawQr(orderUrl);
  loadDevices();
  renderDiscountList();
}

// ---------------- DISCOUNTS (admin management) ----------------
async function renderDiscountList() {
  const box = document.getElementById('discList');
  if (!box) return;
  try { state.discounts = await api('GET', '/discounts'); } catch { box.textContent = 'Could not load discounts.'; return; }
  if (!state.discounts.length) { box.innerHTML = '<p class="muted" style="font-size:13px;margin:0">No discounts yet.</p>'; return; }
  box.innerHTML = state.discounts.map(d => {
    const off = d.type === 'percent' ? `${d.value}%` : money(d.value);
    const limits = [
      d.expiresAt ? `expires ${d.expiresAt.slice(0, 10)}` : 'no expiry',
      d.maxUses != null ? `used ${d.uses}/${d.maxUses}` : `used ${d.uses}×`,
    ].join(' · ');
    const state_ = !d.active ? '<span class="pill">off</span>' : d.expired ? '<span class="pill">expired</span>' : d.spent ? '<span class="pill">used up</span>' : '';
    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);flex-wrap:wrap">
      <div style="flex:1 1 200px"><b style="color:var(--ink)">${esc(d.code)}</b> <span class="pill">${off} off</span> ${state_}
        ${d.label ? `<br><span class="muted" style="font-size:12px">${esc(d.label)}</span>` : ''}
        <br><span class="muted" style="font-size:12px">${limits}</span></div>
      <button class="small secondary" onclick='openDiscount(${JSON.stringify(d)})'>Edit</button>
      <button class="small secondary" onclick="toggleDiscount('${d.id}', ${!d.active})">${d.active ? 'Switch off' : 'Switch on'}</button>
      <button class="small danger" onclick="delDiscount('${d.id}','${esc(d.code)}')">Remove</button>
    </div>`;
  }).join('');
}
window.openDiscount = (d) => {
  d = d || null;
  openModal(`
    <button class="ghost small close" onclick="closeModal()">✕</button>
    <h3>${d ? 'Edit' : 'Issue a'} discount</h3>
    <div id="dscMsg"></div>
    <label>Code</label>
    <input id="dscCode" value="${d ? esc(d.code) : ''}" placeholder="e.g. STAFF20" style="text-transform:uppercase">
    <label>Description <span class="muted">(optional)</span></label>
    <input id="dscLabel" value="${d ? esc(d.label || '') : ''}" placeholder="e.g. staff rate">
    <div class="row">
      <div><label>Type</label>
        <select id="dscType">
          <option value="percent" ${!d || d.type === 'percent' ? 'selected' : ''}>Percentage off</option>
          <option value="fixed" ${d && d.type === 'fixed' ? 'selected' : ''}>Fixed amount off</option>
        </select></div>
      <div><label>Value</label><input id="dscValue" type="number" step="0.01" min="0" value="${d ? d.value : ''}" placeholder="e.g. 20"></div>
    </div>
    <div class="row">
      <div><label>Expires <span class="muted">(optional)</span></label><input id="dscExpires" type="date" value="${d && d.expiresAt ? d.expiresAt.slice(0, 10) : ''}"></div>
      <div><label>Max uses <span class="muted">(optional)</span></label><input id="dscMax" type="number" min="1" value="${d && d.maxUses != null ? d.maxUses : ''}" placeholder="unlimited"></div>
    </div>
    <p class="muted" style="font-size:12px;margin:8px 0 0">A percentage applies to the order total; a fixed amount is capped at the total, never below zero.</p>
    <button class="btn-full" style="margin-top:16px" onclick="saveDiscount(${d ? `'${d.id}'` : 'null'})">Save</button>
  `);
};
window.saveDiscount = async (id) => {
  const body = {
    code: $('#dscCode').value.trim(),
    label: $('#dscLabel').value.trim(),
    type: $('#dscType').value,
    value: $('#dscValue').value,
    expiresAt: $('#dscExpires').value || '',
    maxUses: $('#dscMax').value || '',
  };
  try {
    if (id) await api('PATCH', `/discounts/${id}`, body);
    else await api('POST', '/discounts', body);
    closeModal(); renderDiscountList();
  } catch (e) { notice($('#dscMsg'), 'err', e.message); }
};
window.toggleDiscount = async (id, active) => {
  try { await api('PATCH', `/discounts/${id}`, { active }); renderDiscountList(); } catch (e) { alert(e.message); }
};
window.delDiscount = async (id, code) => {
  if (!confirm(`Remove the discount ${code}? Orders that already used it keep their discount.`)) return;
  try { await api('DELETE', `/discounts/${id}`); renderDiscountList(); } catch (e) { alert(e.message); }
};

// ---------------- REPAIR PAYMENT RECORDS ----------------
window.previewBackfill = async () => {
  const box = $('#bfResult');
  box.innerHTML = '<p class="muted">Checking…</p>';
  try {
    const r = await api('POST', '/orders/backfill-payments', { apply: false });
    if (!r.orders) {
      box.innerHTML = `<p class="muted">All ${r.scanned} order(s) already carry a full payment record. Nothing to repair.</p>`;
      return;
    }
    const rows = r.repairs.map(x => `<tr><td>#${x.number}</td><td>${esc(x.guestName || '')}</td><td>${money(x.amount)}</td><td>${x.method}</td><td>${String(x.at).slice(0, 10)}</td><td>${esc(x.by || '—')}</td></tr>`).join('');
    box.innerHTML = `<p><b>${r.orders}</b> order(s) are missing a payment record, totalling <b>${money(r.amount)}</b>.</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Guest</th><th>Amount</th><th>Method</th><th>Paid</th><th>Taken by</th></tr></thead><tbody>${rows}</tbody></table></div>
      <button class="danger" style="margin-top:12px" onclick="applyBackfill(${r.orders})">Apply to ${r.orders} order(s)</button>`;
  } catch (e) { notice($('#bfMsg'), 'err', e.message); box.innerHTML = ''; }
};
window.applyBackfill = async (n) => {
  if (!confirm(`Rebuild the payment record on ${n} order(s)? Each gets a payment entry matching its price, payment time and cashier. Take a backup first if you want a way back.`)) return;
  try {
    const r = await api('POST', '/orders/backfill-payments', { apply: true });
    notice($('#bfMsg'), 'ok', `Repaired ${r.orders} order(s), ${money(r.amount)} now recorded. Re-run your report to see it.`);
    $('#bfResult').innerHTML = '';
  } catch (e) { notice($('#bfMsg'), 'err', e.message); }
};
async function loadDevices() {
  const box = document.getElementById('devList');
  if (!box) return;
  let devs = [];
  try { devs = await api('GET', '/push/devices'); } catch { box.textContent = 'Could not load devices.'; return; }
  if (!devs.length) { box.textContent = 'No devices have enabled alerts yet. On each device, tap "🔔 Enable alerts" in the top bar.'; return; }
  box.innerHTML = devs.map(d => `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);flex-wrap:wrap">
    <div style="flex:1 1 160px"><b style="color:var(--ink)">${esc(d.label)}</b> <span class="pill">${esc(d.role)}</span><br><span class="muted" style="font-size:12px">enabled ${fmt(d.at)}</span></div>
    <label style="display:flex;gap:6px;align-items:center;font-weight:400;margin:0;font-size:13px"><input type="checkbox" style="width:auto" ${d.shiftReminders ? 'checked' : ''} onchange="toggleDeviceShift('${d.id}', this.checked)"> shift reminder</label>
    <button class="small danger" onclick="removeDevice('${d.id}')">Remove</button>
  </div>`).join('');
}
window.toggleDeviceShift = async (id, on) => { try { await api('PATCH', `/push/devices/${id}`, { shiftReminders: on }); } catch (e) { alert(e.message); } };
window.removeDevice = async (id) => { if (!confirm('Remove this device from notifications?')) return; try { await api('DELETE', `/push/devices/${id}`); loadDevices(); } catch (e) { alert(e.message); } };
window.downloadBackup = async () => {
  try {
    const res = await fetch('/api/backup', { headers: { authorization: `Bearer ${state.token}` } });
    if (!res.ok) throw new Error('Backup failed — are you signed in as admin?');
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `laundry-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    notice($('#bkMsg'), 'ok', 'Backup downloaded. Store it somewhere safe.');
  } catch (e) { notice($('#bkMsg'), 'err', e.message); }
};
window.restoreBackup = async (input) => {
  const f = input.files[0]; input.value = '';
  if (!f) return;
  if (!confirm('Restore will OVERWRITE all current data (orders, staff, settings) with this file. Continue?')) return;
  try {
    const data = JSON.parse(await f.text());
    const r = await api('POST', '/backup/restore', { data });
    notice($('#bkMsg'), 'ok', `Restored ${r.counts.orders} order(s) and ${r.counts.cashiers} staff. Reloading…`);
    setTimeout(() => location.reload(), 1600);
  } catch (e) { notice($('#bkMsg'), 'err', /JSON/.test(e.message) ? 'That file isn\'t a valid backup.' : e.message); }
};
window.saveRooms = async () => {
  try {
    state.settings = await api('PUT', '/settings', { rooms: $('#stRooms').value });
    notice($('#roomsMsg'), 'ok', `Saved ${state.settings.rooms.length} room(s). Cashiers will see them in the room dropdown.`);
  } catch (e) { notice($('#roomsMsg'), 'err', e.message); }
};
window.saveSequence = async () => {
  const next = parseInt($('#seqNext').value, 10);
  if (!next || next < 1) return notice($('#seqMsg'), 'err', 'Enter a positive whole number.');
  if (!confirm(`Set the next order number to #${next}?`)) return;
  try {
    const r = await api('POST', '/sequence', { next });
    $('#seqCurrent').textContent = r.next;
    $('#seqNext').value = '';
    notice($('#seqMsg'), 'ok', `The next order will be #${r.next}.`);
  } catch (e) { notice($('#seqMsg'), 'err', e.message); }
};
window.deleteOrdersRange = async () => {
  const from = $('#delFrom').value, to = $('#delTo').value;
  if (!from || !to) return notice($('#delMsg'), 'err', 'Choose both a start and end date.');
  if (!confirm(`Permanently delete ALL orders created between ${from} and ${to}? This cannot be undone.`)) return;
  try {
    const r = await api('POST', '/orders/delete-range', {
      from: new Date(from + 'T00:00:00').toISOString(),
      to: new Date(to + 'T23:59:59').toISOString(),
    });
    notice($('#delMsg'), 'ok', `Deleted ${r.removed} order(s). ${r.remaining} remaining.`);
    state.knownOrderIds = null;
  } catch (e) { notice($('#delMsg'), 'err', e.message); }
};
window.previewLogo = (input) => {
  const f = input.files[0]; if (!f) return;
  if (f.size > 400000) { notice($('#setMsg'), 'err', 'Logo too large — please use an image under 400KB.'); input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = () => { const img = $('#logoPreview'); img.src = reader.result; img.style.display = 'inline'; state._newLogo = reader.result; };
  reader.readAsDataURL(f);
};
window.clearLogo = () => { state._newLogo = ''; $('#logoPreview').style.display = 'none'; };
window.saveSettings = async () => {
  const [code, symbol] = $('#stCurrency').value.split('|');
  const body = {
    hostelName: $('#stName').value.trim(), accentColor: $('#stColor').value, hoverColor: $('#stHover').value,
    currency: { code, symbol }, rooms: $('#stRooms').value, pricePerLoad: $('#stPrice').value, piecesPerLoad: $('#stPieces').value,
    requireEmail: $('#stReqEmail').checked, requireRoomOnAccept: $('#stReqRoom').checked,
    turnaroundHours: $('#stTurn').value,
    followUpHours: $('#stFollowUp').value, followUpEveryHours: $('#stFollowEvery').value,
    pickupLeadHours: $('#stPickupLead').value,
    readyStuckHours: $('#stReadyStuck').value,
    readyAlertUserIds: [...document.querySelectorAll('.readyUser:checked')].map(c => c.value),
    quietFrom: $('#stQuietFrom').value, quietTo: $('#stQuietTo').value,
    adminEmail: $('#stAdminEmail').value.trim(), receptionEmail: $('#stRecEmail').value.trim(),
    alertRecipients: $('#stAlertRecipients').value,
    baseUrl: $('#stBase').value.trim(),
  };
  if (state._newLogo !== undefined) body.logoDataUrl = state._newLogo;
  try {
    state.settings = await api('PUT', '/settings', body);
    delete state._newLogo;
    $('#topName').textContent = state.settings.hostelName || 'Laundry';
    document.documentElement.style.setProperty('--accent', state.settings.accentColor);
    document.documentElement.style.setProperty('--hover', state.settings.hoverColor || '#FFF8ED');
    notice($('#setMsg'), 'ok', 'Settings saved.');
    window.scrollTo(0, 0);
  } catch (e) { notice($('#setMsg'), 'err', e.message); }
};
function drawQr(url) {
  const box = $('#qrbox'); if (!box || !window.QRCode) return;
  box.innerHTML = ''; new QRCode(box, { text: url, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M });
}
window.downloadQr = () => {
  const cvs = $('#qrbox canvas'); const img = $('#qrbox img');
  const src = cvs ? cvs.toDataURL('image/png') : (img ? img.src : null);
  if (!src) return;
  const a = document.createElement('a'); a.href = src; a.download = 'laundry-order-qr.png'; a.click();
};

// ---------------- modal ----------------
function openModal(html) { $('#modalHost').innerHTML = `<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal">${html}</div></div>`; }
window.closeModal = () => { $('#modalHost').innerHTML = ''; };

// Test hooks (harmless in production).
window.__test = { state, renderShiftEndBanner, checkShiftBoundary, currentShiftType };

boot();
