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

function isHousekeeping() { return state.user?.role === 'housekeeping'; }
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
  const b = document.querySelector('#muteBtn .sw');
  if (b) b.classList.toggle('on', !state.muted);
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
function notice(el, kind, text) { if (el) el.innerHTML = text ? `<div class="notice ${kind}">${esc(text)}</div>` : ''; }
function round2m(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function moneyShort(n) { const v = Number(n) || 0; return `${cur()}${Number.isInteger(round2m(v)) ? round2m(v) : v.toFixed(2)}`; }
function hm(iso) { if (!iso) return '—'; return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
function dayLabel(iso) {
  if (!iso) return '—';
  const d = new Date(iso), n = new Date();
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 864e5);
  if (days === 0) return 'Today ' + hm(iso); if (days === 1) return 'Tomorrow ' + hm(iso); if (days === -1) return 'Yesterday ' + hm(iso);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + hm(iso);
}
function dur(ms) { const m = Math.max(0, Math.round(ms / 60000)); if (m < 60) return m + ' min'; const h = Math.floor(m / 60), r = m % 60; if (h < 48) return h + 'h' + (r ? ' ' + r + 'm' : ''); return Math.round(h / 24) + ' days'; }

// ---------------- icons ----------------
const ICON = {
  orders: '<path d="M8 3.5 3.5 6 2 11l3 1.2V20h14v-7.8l3-1.2-1.5-5L16 3.5"/><path d="M8 3.5a4 4 0 0 0 8 0"/>',
  linen: '<path d="m3 8 9-4 9 4-9 4z"/><path d="m3 12 9 4 9-4M3 16l9 4 9-4"/>',
  msg: '<path d="M4 5h16v11H9l-5 4z"/>',
  reports: '<path d="M4 20V11M10 20V5M16 20v-6M3 20h18"/>',
  staff: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  guide: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6.5 2.5 8 2.5 8h-17S6 15.5 6 9"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  sound: '<path d="M4 9.5v5h4l5 4v-13l-5 4z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v.01M18 14.5v.01"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2.2"/><path d="M2.5 10h19M6.5 15h3"/>',
  door: '<path d="M14 3.5H6.5v17H14"/><path d="M14 3.5 19 5v15l-5 1.5z"/><path d="M16.3 12v.01"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H12"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.3v.01"/>',
  tag: '<path d="M3 12V4h8l9.5 9.5-8 8z"/><circle cx="7.5" cy="8.5" r="1.4"/>',
  send: '<path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  pause: '<circle cx="12" cy="12" r="8.5"/><path d="M10 9v6M14 9v6"/>',
  washer: '<rect x="4" y="2.5" width="16" height="19" rx="2.5"/><circle cx="12" cy="13" r="5"/><path d="M7.5 6h3"/>',
};
function ic(n, cls = '') { return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ''}</svg>`; }
const TAB_ICON = { orders: 'orders', linen: 'linen', messages: 'msg', reports: 'reports', cashiers: 'staff', settings: 'settings', guide: 'guide' };
const ROLE_LABEL = { admin: 'Admin', cashier: 'Reception', laundry: 'Laundry attendant', housekeeping: 'Housekeeping' };
function tabLabel(id) { return { orders: state.user?.role === 'laundry' ? 'Queue' : 'Orders', linen: 'Linen', messages: 'Messages', reports: 'Reports', cashiers: 'Staff', settings: 'Settings', guide: 'Guide' }[id] || id; }

// ---------------- toasts ----------------
// A short confirmation at the bottom. With `undo`, it carries an Undo button for
// as long as the server still allows it.
function toast(text, opts = {}) {
  const host = document.getElementById('toasts'); if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast' + (opts.err ? ' err' : ''); el.setAttribute('role', 'status');
  const span = document.createElement('span'); span.textContent = text; el.appendChild(span);
  if (opts.undo) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Undo';
    b.onclick = async () => { b.disabled = true; try { await opts.undo(); } catch (e) { toast(e.message, { err: true }); } el.remove(); };
    el.appendChild(b);
  }
  host.appendChild(el);
  while (host.children.length > 2) host.firstChild.remove();
  setTimeout(() => el.remove(), opts.undo ? 10000 : 4500);
}

// ---------------- light / dark ----------------
function themePref() { try { return localStorage.getItem('laundry_theme') || 'system'; } catch { return 'system'; } }
window.applyTheme = (t) => {
  try { if (t === 'system') localStorage.removeItem('laundry_theme'); else localStorage.setItem('laundry_theme', t); } catch {}
  if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  renderThemeSeg();
};
function renderThemeSeg() {
  const h = document.getElementById('themeSeg'); if (!h) return;
  const curT = themePref();
  h.innerHTML = [['system', 'Device'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button type="button" aria-pressed="${curT === k}" onclick="applyTheme('${k}')">${l}</button>`).join('');
}

// ---------------- menus ----------------
function closeMenus() {
  ['userMenu', 'shiftMenu', 'moreMenu'].forEach(id => { const m = document.getElementById(id); if (m) m.classList.add('hidden'); });
  const b = document.getElementById('menuBackdrop'); if (b) b.classList.add('hidden');
}
window.closeMenus = closeMenus;
function openMenu(id) {
  const m = document.getElementById(id), open = !m.classList.contains('hidden');
  closeMenus(); if (open) return;
  m.classList.remove('hidden'); $('#menuBackdrop').classList.remove('hidden');
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const anyMenu = ['userMenu', 'shiftMenu', 'moreMenu'].some(id => { const m = document.getElementById(id); return m && !m.classList.contains('hidden'); });
  if (anyMenu) return closeMenus();
  if ($('#modalHost') && $('#modalHost').innerHTML) closeModal();
});

// ---------------- brand ----------------
function applyBrand(s) {
  if (s.accentColor) {
    document.documentElement.style.setProperty('--accent', s.accentColor);
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = s.accentColor;
  }
  document.documentElement.style.setProperty('--hover', s.hoverColor || '#FFF8ED');
}
function monogram(name) { const w = String(name || 'Laundry').trim().split(/\s+/); return ((w[0] || 'L')[0] + (w[1] ? w[1][0] : '')).toLowerCase(); }


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
// ---------------- new version of the app ----------------
// The reception terminal and staff phones keep the app open for days, and an
// open page keeps running the code it loaded. Every few minutes, compare the
// app's files with the server's: when they change, reload at once if nobody is
// signed in (lock screen), otherwise offer a one-tap reload.
const APP_FILES = ['/assets/app.js', '/assets/guide.js', '/assets/linen.js', '/assets/linen-simple.js', '/assets/styles.css', '/app.html'];
let _appVersion = null;
async function appVersion() {
  const tags = await Promise.all(APP_FILES.map((f) => fetch(f, { method: 'HEAD', cache: 'no-store' })
    .then((r) => (r.ok ? r.headers.get('etag') || r.headers.get('last-modified') || '' : '')).catch(() => '')));
  return tags.every((t) => !t) ? null : tags.join('|');
}
async function checkForUpdate() {
  const v = await appVersion().catch(() => null);
  if (!v) return;
  if (_appVersion === null) { _appVersion = v; return; }
  if (v === _appVersion) return;
  if (!state.user) return location.reload(); // lock screen: nobody's work to lose
  if (document.getElementById('updateBar')) return;
  const bar = document.createElement('div');
  bar.id = 'updateBar'; bar.className = 'update-bar';
  bar.innerHTML = '<span>A new version of the app is ready.</span><button class="small" onclick="location.reload()">Reload now</button>';
  document.body.appendChild(bar);
}

async function boot() {
  registerSW();
  checkForUpdate();
  setInterval(checkForUpdate, 5 * 60000);
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
  hideAll(); $('#lockScreen').classList.remove('hidden'); closeMenus();
  state.pin = ''; renderPinDots(); notice($('#pinMsg'), '', '');
  try { const s = await (await fetch('/api/public-settings')).json();
    if (s.accentColor) applyBrand(s);
    else if (s.hoverColor) document.documentElement.style.setProperty('--hover', s.hoverColor);
    $('#lockName').textContent = s.hostelName || 'Laundry';
    if (s.logoDataUrl && !$('#lockBrand img')) { const i = document.createElement('img'); i.src = s.logoDataUrl; i.alt = ''; $('#lockBrand').prepend(i); }
  } catch {}
  buildPinpad();
  renderLockInfo();
  renderShiftEndBanner();
}
// The time, and the shift still open from before the lock, for whoever walks up.
function renderLockInfo() {
  const d = new Date();
  $('#lockClock').textContent = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  $('#lockDate').textContent = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const s = state.shift, box = $('#lockShift');
  if (s && s.open && s.shift) {
    const ip = (s.inProgress || []).length;
    box.innerHTML = `<b>${esc(s.shift.type)} shift is open</b><span>${esc(s.shift.cashierName)} since ${hm(s.shift.openedAt)} · ${ip} order${ip === 1 ? '' : 's'} in progress</span>`;
    box.classList.remove('hidden');
  } else box.classList.add('hidden');
}
setInterval(() => { const l = document.getElementById('lockScreen'); if (l && !l.classList.contains('hidden')) renderLockInfo(); }, 20000);

function renderShiftEndBanner() {
  const card = document.querySelector('#lockScreen .card');
  const h2 = card.querySelector('h2');
  const hint = card.querySelector('.hint');
  let banner = document.getElementById('shiftEndBanner');
  if (!state.shiftEnded) {
    if (banner) banner.remove();
    h2.textContent = 'Enter your PIN';
    hint.textContent = 'Your PIN signs you in as yourself.';
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
  keys.forEach(k => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = k; b.onclick = () => pinKey(k);
    if (k === 'OK') b.className = 'ok';
    if (k === '⌫') { b.className = 'del'; b.setAttribute('aria-label', 'Delete'); }
    pad.appendChild(b);
  });
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
  catch {
    state.pin = ''; renderPinDots();
    const dots = $('#pinDots'); dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
    return notice($('#pinMsg'), 'err', 'That PIN didn’t match anyone. Try again.');
  }

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
  if (typeof lsCamStop === 'function') lsCamStop(); // never leave the camera on behind the lock screen
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
  hideAll(); $('#app').classList.remove('hidden'); closeMenus();
  initAudio(); // PIN entry is a user gesture, so audio is now allowed
  const st = state.settings || {};
  $('#topName').textContent = st.hostelName || 'Laundry';
  applyBrand(st);
  const mono = $('#railMono');
  mono.innerHTML = st.logoDataUrl ? `<img src="${esc(st.logoDataUrl)}" alt="">` : esc(monogram(st.hostelName));
  mono.title = st.hostelName || '';
  $('#whoName').textContent = state.user.name;
  $('#whoRole').textContent = ROLE_LABEL[state.user.role] || state.user.role;
  $('#avatarBtn').textContent = (state.user.name || '?').trim()[0].toUpperCase();
  $('#avatarBtn').onclick = () => openMenu('userMenu');
  $('#menuBackdrop').onclick = closeMenus;
  $('#lockBtn').innerHTML = `${ic('lock', 'lg')}<span>Lock</span>`; $('#lockBtn').onclick = lock;
  $('#menuLock').innerHTML = `${ic('lock', 'sm')}Lock or switch user`; $('#menuLock').onclick = () => { closeMenus(); lock(); };
  $('#moreBtn').innerHTML = `${ic('more', 'lg')}<span>More</span>`; $('#moreBtn').onclick = () => openMenu('moreMenu');
  $('#shiftChip').onclick = onShiftChip;
  state.q = ''; state.filter = null; state.laneIdx = 0;
  renderThemeSeg();
  ensureTopbarControls();
  resetIdle();
  state.knownOrderIds = null;
  state.pendingMsg = 0; state.pendingFollowUp = 0; state._lastFollowUp = 0; state._lastFollowUpPing = 0;
  buildTabs();
  if (isHousekeeping()) {
    // No till, no guest orders: no shift prompts, order chimes or polling.
    if (state.poll) clearInterval(state.poll);
    if (state.pingTimer) clearInterval(state.pingTimer);
    selectTab('linen');
    return;
  }
  await refreshShift(); // load shift status before first render so the shift bar shows
  await refreshAlerts();
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
  const host = $('#menuControls'); host.innerHTML = '';
  // "Alerts on this device" — every role can subscribe this device to push.
  const n = document.createElement('button');
  n.type = 'button'; n.id = 'notifyBtn';
  n.innerHTML = `${ic('bell', 'sm')}<span>${'Notification' in window && Notification.permission === 'granted' ? 'Alerts are on for this device' : 'Turn on alerts for this device'}</span>`;
  n.onclick = () => { closeMenus(); window.enableNotifications(); };
  host.appendChild(n);
  updateNotifyBtn();
  // Sound for new orders — only an admin may turn it off.
  if (state.user.role === 'admin') {
    const mute = document.createElement('button');
    mute.type = 'button'; mute.id = 'muteBtn';
    mute.innerHTML = `${ic('sound', 'sm')}<span>Sound for new orders</span><i class="sw ${state.muted ? '' : 'on'}"></i>`;
    mute.onclick = toggleMute;
    host.appendChild(mute);
  }
}

// ---------------- shift (till session) ----------------
async function refreshShift() {
  try { state.shift = await api('GET', '/shifts/current'); } catch { state.shift = { open: false }; }
  renderShiftChip();
}
function renderShiftChip() {
  const chip = $('#shiftChip'); if (!chip) return;
  const s = state.shift;
  if (!s || isHousekeeping()) { chip.classList.add('hidden'); return; }
  chip.classList.remove('hidden');
  chip.innerHTML = s.open
    ? `<span class="live"></span>${esc(s.shift.type)} shift <small>· ${esc(s.shift.cashierName)} since ${hm(s.shift.openedAt)}</small>`
    : `<span class="live off"></span>No shift open <small>· Start shift</small>`;
  chip.setAttribute('aria-label', s.open ? `${s.shift.type} shift open. Shift options` : 'No shift open. Start shift');
}
function onShiftChip() {
  const s = state.shift; if (!s) return;
  if (!s.open) return openStartShift();
  const ip = (s.inProgress || []).length;
  $('#shiftMenu').innerHTML = `<div class="who"><b>${esc(s.shift.type)} shift · open</b><small>${esc(s.shift.cashierName)} since ${hm(s.shift.openedAt)} · ${ip} order${ip === 1 ? '' : 's'} in progress</small></div>
    <div class="sep"></div><button type="button" onclick="closeMenus();openCloseShift()">${ic('clock', 'sm')}Close shift and hand over</button>`;
  openMenu('shiftMenu');
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
  // Housekeeping only handles linen; everybody else starts on the order board.
  const tabs = isHousekeeping() ? [] : [{ id: 'orders', label: 'Orders' }];
  if (lnCanSee()) tabs.push({ id: 'linen', label: 'Linen' });
  if (can('messageGuests')) tabs.push({ id: 'messages', label: 'Messages' });
  if (can('viewReports')) tabs.push({ id: 'reports', label: 'Reports' });
  if (can('manageCashiers')) tabs.push({ id: 'cashiers', label: 'Cashiers' });
  if (can('manageSettings')) tabs.push({ id: 'settings', label: 'Settings' });
  tabs.push({ id: 'guide', label: 'Guide' }); // the laundry handbook — every role
  const host = $('#tabs'); host.innerHTML = '';
  const many = tabs.length > 5;
  tabs.forEach((t, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.tab = t.id; b.title = tabLabel(t.id);
    if (many && i >= 4) b.classList.add('overflow');
    b.innerHTML = `${ic(TAB_ICON[t.id], 'lg')}<span>${tabLabel(t.id)}</span><span class="tab-badge hidden" id="badge-${t.id}"></span>`;
    b.onclick = () => selectTab(t.id);
    host.appendChild(b);
  });
  $('#rail').classList.toggle('has-more', many);
  $('#moreMenu').innerHTML = tabs.slice(4).map(t => `<button type="button" onclick="closeMenus();selectTab('${t.id}')">${ic(TAB_ICON[t.id], 'sm')}${tabLabel(t.id)}</button>`).join('');
}
function selectTab(id) {
  state.tab = id; closeMenus();
  document.querySelectorAll('#tabs button').forEach(b => { b.classList.toggle('active', b.dataset.tab === id); if (b.dataset.tab === id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $('#viewTitle').textContent = tabLabel(id);
  $('#topTools').innerHTML = '';
  const sc = $('#scroller'); if (sc) sc.scrollTop = 0;
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
    if (state.tab === 'guide') return renderGuide(view, state.user);
    if (state.tab === 'linen') return await renderLinen(view);
  } catch (e) { if (!silent) view.innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
}

// ---------------- ORDERS ----------------
const STAGES = [
  { id: 'new', label: 'New', long: 'New', color: 'var(--s-new)' },
  { id: 'accepted', label: 'Accepted', long: 'Accepted', color: 'var(--s-acc)' },
  { id: 'cleaning', label: 'Cleaning', long: 'Cleaning', color: 'var(--s-cln)' },
  { id: 'ready', label: 'Ready', long: 'Ready for pickup', color: 'var(--s-rdy)' },
];
const STAGE_COLOR = { new: 'var(--s-new)', accepted: 'var(--s-acc)', cleaning: 'var(--s-cln)', ready: 'var(--s-rdy)', completed: 'var(--s-done)', cancelled: 'var(--s-cancel)' };
const STATUS_LONG = { ...STATUS_LABEL, ready: 'Ready for pickup', completed: 'Picked up' };
const isLaundry = () => state.user?.role === 'laundry';
const unreadOf = (o) => (o.messages || []).filter(m => m.sender === 'guest' && !m.readByStaff).length;
const estOf = (o) => (o.loads || 1) * (state.settings?.pricePerLoad || 0);
const balanceOf = (o) => Math.max(0, round2m((Number(o.price) || 0) - (Number(o.amountPaid) || 0)));
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'The guest';
const byPickup = (a, b) => new Date(a.pickupAt || a.createdAt) - new Date(b.pickupAt || b.createdAt);
const isToday = (iso) => iso && new Date(iso).toDateString() === new Date().toDateString();
// When a stage was reached: newer orders carry the timestamp, older ones only have it in the log.
function stageAt(o, stage) {
  const f = { accepted: 'acceptedAt', cleaning: 'cleaningAt', ready: 'readyAt', completed: 'completedAt' }[stage];
  if (f && o[f]) return o[f];
  const hit = (o.logs || []).filter(l => l.action === 'status' && l.detail === `Status → ${stage}`).pop();
  return hit ? hit.at : null;
}

// What needs a human, using the same rules the reminders already follow.
function attentionOf(o) {
  if (!['new', 'accepted', 'cleaning', 'ready'].includes(o.status)) return null;
  const now = Date.now();
  if (isSnoozedO(o)) return { kind: 'calm', icon: 'pause', text: 'Delay noted' + (o.delayReason ? ': ' + o.delayReason : '') };
  if (acceptedTooLong(o)) return { kind: 'warn', icon: 'clock', text: `Waiting ${dur(now - new Date(o.acceptedAt))} to start` };
  if (o.status === 'ready' && o.readyAt && now - new Date(o.readyAt) > (state.settings?.readyStuckHours || 12) * 3600000) {
    return { kind: 'bad', icon: 'alert', text: `Not collected · ready ${dur(now - new Date(o.readyAt))}` };
  }
  if (pickupApproaching(o)) return { kind: 'warn', icon: 'clock', text: `Pickup in ${dur(new Date(o.pickupAt) - now)}${isLaundry() ? ' · check the lines' : ''}` };
  if (pickupPast(o) && o.status !== 'ready') return { kind: 'bad', icon: 'alert', text: `Pickup was due ${dur(now - new Date(o.pickupAt))} ago` };
  return null;
}
const needsAttention = (o) => { const a = attentionOf(o); return !!a && a.kind !== 'calm'; };

// The one next step for this order, for this person.
function nextAction(o) {
  if (o.status === 'new') return can('acceptOrders') ? { label: 'Accept', fn: `openAccept('${o.id}')` } : null;
  if (o.status === 'accepted') return can('advanceStatus') ? { label: 'Start cleaning', fn: `advance('${o.id}')` } : null;
  if (o.status === 'cleaning') return can('advanceStatus') ? { label: 'Mark ready', fn: `advance('${o.id}')` } : null;
  if (o.status === 'ready') {
    if (isLaundry()) return null;
    if (o.paymentStatus === 'paid') return can('advanceStatus') ? { label: 'Mark picked up', fn: `advance('${o.id}')` } : null;
    return can('takePayment') ? { label: 'Take payment', fn: `takePayment('${o.id}')`, soft: true } : null;
  }
  return null;
}
function payChip(o) {
  if (o.status === 'new') return `<span class="pay est">${o.paymentTiming === 'now' ? 'Pays now · ' : ''}est. ${moneyShort(estOf(o))}</span>`;
  if (o.paymentStatus === 'paid') return `<span class="pay paid">${ic('check', 'sm')}Paid${o.paymentMethod ? ' · ' + esc(o.paymentMethod) : ''}</span>`;
  if (o.paymentStatus === 'partial') return `<span class="pay part">${moneyShort(balanceOf(o))} due</span>`;
  return `<span class="pay unpaid">Unpaid ${moneyShort(balanceOf(o))}</span>`;
}

async function renderOrders(view, silent) {
  const orders = await api('GET', '/orders');
  // Detect genuinely new orders → play the reception ping.
  const newIds = orders.filter(o => o.status === 'new').map(o => o.id);
  state.pendingNew = newIds.length; // drives the repeating ping until all are accepted
  state.freshIds = [];
  if (state.knownOrderIds !== null) {
    const fresh = newIds.filter(id => !state.knownOrderIds.includes(id));
    if (fresh.length) {
      ping(); notifyBg('New laundry order', `${fresh.length} new order(s) awaiting acceptance`, 'new-order');
      state.freshIds = fresh;
      if (!isLaundry()) toast(fresh.length === 1 ? `New order ${orders.find(o => o.id === fresh[0]).number} from ${firstName(orders.find(o => o.id === fresh[0]).guestName)}` : `${fresh.length} new orders`);
    }
  }
  state.knownOrderIds = newIds;
  state.pendingFollowUp = inQuietHoursNow() ? 0 : orders.filter(needsFollowUp).length;
  if (can('messageGuests')) {
    state.pendingMsg = orders.reduce((n, o) => n + unreadOf(o), 0);
    setBadge('messages', state.pendingMsg);
  }
  setBadge('orders', isLaundry() ? 0 : newIds.length);
  state.orders = orders; window._orders = orders;
  if (state.tab !== 'orders') return; // finished loading after the user moved on
  if (isLaundry()) { view.innerHTML = attendantHtml(orders); return; }
  renderOrderSearch();
  drawBoard(view);
}
function drawBoard(view = $('#view')) {
  view.innerHTML = boardHtml(state.orders || []);
  const l = $('#lanes'); if (l && l.children[state.laneIdx || 0]) l.scrollLeft = l.children[state.laneIdx].offsetLeft - l.children[0].offsetLeft;
}
function renderOrderSearch() {
  const host = $('#topTools');
  if (!host || host.querySelector('#orderSearch')) return;
  host.innerHTML = `<label class="search">${ic('search', 'sm')}<input id="orderSearch" type="search" placeholder="Guest, room or number" autocomplete="off" aria-label="Search orders" value="${esc(state.q || '')}"></label>`;
  $('#orderSearch').addEventListener('input', (e) => { state.q = e.target.value; drawBoard(); });
}
function matchesFilter(o) {
  if (state.q) { const q = state.q.toLowerCase(); if (!`${o.number} ${o.guestName} ${o.room || ''}`.toLowerCase().includes(q)) return false; }
  if (state.filter === 'attn') return needsAttention(o);
  if (state.filter === 'unpaid') return o.status !== 'new' && o.paymentStatus !== 'paid';
  if (state.filter === 'due') return isToday(o.pickupAt);
  return true;
}
function boardHtml(orders) {
  const live = orders.filter(o => STAGE_COLOR[o.status] && !['completed', 'cancelled'].includes(o.status));
  const nAttn = live.filter(needsAttention).length;
  const unpaid = live.filter(o => o.status !== 'new' && o.paymentStatus !== 'paid');
  const owed = unpaid.reduce((a, o) => a + balanceOf(o), 0);
  const nDue = live.filter(o => isToday(o.pickupAt)).length;
  const f = (id, label, n, dot) => `<button type="button" class="fchip" aria-pressed="${state.filter === id}" onclick="setOrderFilter('${id}')">${dot ? `<span class="d" style="background:${dot}"></span>` : ''}${label} <b class="num">${n}</b></button>`;
  const recent = orders.filter(o => ['completed', 'cancelled'].includes(o.status)).slice(0, 12);
  return `<div class="glance">
      ${f('attn', 'Needs attention', nAttn, 'var(--warn)')}${f('unpaid', 'Unpaid', unpaid.length, 'var(--bad)')}${f('due', 'Pickup today', nDue)}
      <span class="sep"></span>${owed ? `<span class="hint num">${moneyShort(owed)} still to collect</span>` : ''}
    </div>
    <div class="lanesw" role="tablist" aria-label="Stages">${STAGES.map((s, i) => `<button type="button" role="tab" aria-pressed="${(state.laneIdx || 0) === i}" onclick="scrollLane(${i})"><b>${live.filter(o => o.status === s.id && matchesFilter(o)).length}</b>${s.label}</button>`).join('')}</div>
    <div class="lanes" id="lanes">${STAGES.map(s => laneHtml(s, live.filter(o => o.status === s.id))).join('')}</div>
    <details class="collected"><summary>Picked up &amp; cancelled <span class="c">latest ${recent.length}</span>${ic('chev', 'sm')}</summary>
      <div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Guest</th><th>Room</th><th>Items</th><th class="r">Total</th><th>Status</th><th>When</th></tr></thead>
      <tbody>${recent.map(o => `<tr onclick="openOrder('${o.id}')"><td class="num">${o.number}</td><td>${esc(o.guestName)}</td><td>${esc(o.room || '—')}</td><td>${o.items}</td><td class="r">${money(o.price)}</td><td><span class="badge b-${o.status}">${STATUS_LONG[o.status]}</span></td><td class="muted">${fmt(o.completedAt || o.updatedAt)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">None yet</td></tr>'}</tbody></table></div>
    </details>`;
}
function laneHtml(s, list) {
  list = list.slice().sort((a, b) => (needsAttention(b) ? 1 : 0) - (needsAttention(a) ? 1 : 0) || byPickup(a, b));
  return `<section class="lane" aria-label="${s.long}">
    <div class="lane-h"><span class="d" style="background:${s.color}"></span>${s.long}<span class="c num">${list.length}</span></div>
    <div class="lane-body">${list.length ? list.map(o => orderCard(o, !matchesFilter(o))).join('') : `<div class="empty">Nothing ${s.id === 'new' ? 'waiting' : 'here'}</div>`}</div>
  </section>`;
}
function orderCard(o, dim) {
  const a = attentionOf(o), act = nextAction(o), unread = unreadOf(o), loads = o.loads || 1;
  const cls = [dim ? 'dim' : '', state.movedId === o.id ? 'moved' : '', (state.freshIds || []).includes(o.id) ? 'fresh' : ''].join(' ');
  return `<article class="ocard ${cls}" onclick="openOrder('${o.id}')" onkeydown="if(event.key==='Enter'&&event.target===this)openOrder('${o.id}')" tabindex="0" aria-label="Order ${o.number}, ${esc(o.guestName)}">
    <div class="top"><span class="tag">${o.number}</span><span class="room ${o.room ? '' : 'none'}">${o.room ? ic('door', 'sm') + esc(o.room) : 'No room yet'}</span></div>
    <div class="guest">${esc(o.guestName)}${unread ? `<span class="unread" title="Unread messages">${ic('msg', 'sm')}${unread}</span>` : ''}</div>
    <div class="meta"><span class="num">${o.items} items · ${loads} load${loads > 1 ? 's' : ''}</span>${o.status === 'new' ? `<span>Placed ${hm(o.createdAt)}</span>` : o.pickupAt ? `<span>${ic('clock', 'sm')}${dayLabel(o.pickupAt)}</span>` : ''}${o.discount ? `<span class="pill">${esc(o.discount.code)}</span>` : ''}</div>
    ${o.note && o.status === 'new' ? `<div class="note">“${esc(o.note)}”</div>` : ''}
    ${a ? `<div class="attn ${a.kind === 'bad' ? 'bad' : a.kind === 'calm' ? 'calm' : ''}">${ic(a.icon, 'sm')}<span>${esc(a.text)}</span></div>` : ''}
    <div class="card-f" onclick="event.stopPropagation()">${payChip(o)}${act ? `<button type="button" class="small ${act.soft ? 'soft' : ''}" onclick="${act.fn}">${act.label}</button>` : ''}</div>
  </article>`;
}
window.setOrderFilter = (id) => { state.filter = state.filter === id ? null : id; drawBoard(); };
window.scrollLane = (i) => {
  state.laneIdx = i;
  const l = $('#lanes'); if (l && l.children[i]) l.scrollTo({ left: l.children[i].offsetLeft - l.children[0].offsetLeft, behavior: 'smooth' });
  document.querySelectorAll('.lanesw button').forEach((b, j) => b.setAttribute('aria-pressed', j === i));
};
// Swiping the lanes on a phone keeps the stage switcher in step.
document.addEventListener('scroll', (e) => {
  const l = e.target; if (!(l instanceof Element) || l.id !== 'lanes') return;
  const i = Math.round(l.scrollLeft / Math.max(1, l.clientWidth));
  if (i !== state.laneIdx) { state.laneIdx = i; document.querySelectorAll('.lanesw button').forEach((b, j) => b.setAttribute('aria-pressed', j === i)); }
}, true);

// ---- the laundry attendant's queue: only what they can act on ----
function attendantHtml(orders) {
  const acc = orders.filter(o => o.status === 'accepted').sort(byPickup);
  const cln = orders.filter(o => o.status === 'cleaning').sort(byPickup);
  const nNew = orders.filter(o => o.status === 'new').length;
  const big = (o, i, btn) => {
    const a = attentionOf(o), loads = o.loads || 1;
    const started = o.status === 'cleaning' ? stageAt(o, 'cleaning') : null;
    return `<article class="bigcard ${i === 0 && o.status === 'accepted' ? 'next' : ''} ${state.movedId === o.id ? 'moved' : ''}" onclick="openOrder('${o.id}')">
      ${i === 0 && o.status === 'accepted' ? '<span class="eyebrow">Next up</span>' : ''}
      <div class="card-h"><span class="tag">${o.number}</span><span class="room ${o.room ? '' : 'none'}">${o.room ? ic('door', 'sm') + esc(o.room) : 'No room'}</span></div>
      <div class="guest">${esc(o.guestName)}</div>
      <div class="meta"><span class="num">${o.items} items · ${loads} load${loads > 1 ? 's' : ''}</span>${o.pickupAt ? `<span>${ic('clock', 'sm')}Ready by ${dayLabel(o.pickupAt)}</span>` : ''}</div>
      ${started ? `<div class="meta"><span>${ic('washer', 'sm')}Started ${hm(started)}${o.cleaningBy ? ' by ' + esc(o.cleaningBy.name) : ''} · ${dur(Date.now() - new Date(started))} ago</span></div>` : ''}
      ${a ? `<div class="attn ${a.kind === 'bad' ? 'bad' : a.kind === 'calm' ? 'calm' : ''}">${ic(a.icon, 'sm')}<span>${esc(a.text)}</span></div>` : ''}
      ${can('advanceStatus') ? `<button type="button" class="big btn-full" onclick="event.stopPropagation();advance('${o.id}')">${btn}</button>` : ''}
    </article>`;
  };
  return `${nNew ? `<div class="upcoming">${ic('bell', 'sm')}<span><b>${nNew} new</b> waiting at reception. They appear here once accepted.</span></div>` : ''}
    <section class="att-sec"><h2>Start next <span>${acc.length}</span></h2>${acc.length ? acc.map((o, i) => big(o, i, 'Start cleaning')).join('') : '<div class="empty">Nothing waiting to start</div>'}</section>
    <section class="att-sec"><h2>In the wash <span>${cln.length}</span></h2>${cln.length ? cln.map((o, i) => big(o, i, 'Mark ready')).join('') : '<div class="empty">Nothing in the machines</div>'}</section>`;
}

// Room input: a dropdown of admin-defined rooms, or a free-text box if none are set.
function roomField(id, current) {
  const rooms = state.settings?.rooms || [];
  if (!rooms.length) return `<input id="${id}" placeholder="e.g. Duafe" value="${esc(current || '')}">`;
  const list = rooms.slice();
  if (current && !list.includes(current)) list.push(current);
  return `<select id="${id}"><option value="">— select room —</option>${list.map(r => `<option value="${esc(r)}" ${current === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>`;
}
function paymentPref(o) {
  if (o.paymentTiming === 'now') return `pay now (${o.paymentMethod || 'cash'})`;
  return 'pay at pickup';
}

// ---- order details: a drawer, so the board stays in view ----
window.openOrder = async (id) => {
  const o = await api('GET', `/orders/${id}`);
  // Viewing the order counts as reading any guest messages — stops the message ping.
  if (unreadOf(o)) {
    try { await api('POST', `/orders/${id}/read`); } catch {}
    state.pendingMsg = Math.max(0, (state.pendingMsg || 0) - unreadOf(o));
    setBadge('messages', state.pendingMsg);
  }
  state.drawer = { id, o, more: false };
  drawDrawer();
};
function drawDrawer() {
  const { o } = state.drawer;
  const canModify = o.status === 'new' ? can('acceptOrders') : can('modifyAccepted');
  const total = o.price ?? estOf(o), paid = Number(o.amountPaid) || 0, act = nextAction(o), a = attentionOf(o), loads = o.loads || 1;
  const steps = [['New', o.createdAt, null], ['Accepted', stageAt(o, 'accepted'), o.acceptedBy], ['Cleaning', stageAt(o, 'cleaning'), o.cleaningBy], ['Ready', stageAt(o, 'ready'), o.readyBy], ['Picked up', stageAt(o, 'completed'), o.completedBy]];
  const order = ['new', 'accepted', 'cleaning', 'ready', 'completed'];
  const idx = o.status === 'cancelled' ? steps.reduce((m, s, i) => (s[1] ? i : m), 0) : order.indexOf(o.status);
  const stepCls = (i) => o.status === 'cancelled' ? (i <= idx ? 'done' : '') : (i < idx || (i === idx && i === 4) ? 'done' : i === idx ? 'now' : '');
  const more = [
    o.status !== 'new' && !['completed', 'cancelled'].includes(o.status) && canModify ? `<button type="button" onclick="openModify('${o.id}')">${ic('edit', 'sm')}Edit order</button>` : '',
    ['accepted', 'cleaning', 'ready'].includes(o.status) && can('advanceStatus') ? `<button type="button" onclick="reportDelay('${o.id}')">${ic('pause', 'sm')}Report a delay</button>` : '',
    REVERSE_LABEL[o.status] && can('reverseStatus') ? `<button type="button" onclick="revert('${o.id}')">${ic('undo', 'sm')}Move back to ${REVERSE_LABEL[o.status]}</button>` : '',
    !['completed', 'cancelled'].includes(o.status) && can('cancelOrders') ? `<div class="sep"></div><button type="button" class="red" onclick="askCancel('${o.id}')">${ic('x', 'sm')}Cancel order…</button>` : '',
  ].filter(Boolean).join('');
  const msgs = (o.messages || []).map(m => `<div class="msg ${m.sender}"><div class="who">${m.sender === 'staff' ? esc(m.staffName || 'Reception') : esc(firstName(o.guestName))} · ${fmt(m.at)}</div>${esc(m.text)}</div>`).join('');
  const logs = (o.logs || []).slice().reverse().map(l => `<div class="log"><b>${esc(l.actor)}</b> <span class="muted">(${esc(l.role)})</span> · ${esc(l.detail)}<br><span class="muted" style="font-size:11px">${fmt(l.at)}</span></div>`).join('');
  const primary = act ? `<button type="button" onclick="${act.fn}">${act.fn.startsWith('takePayment') ? `Take ${moneyShort(balanceOf(o))}` : act.fn.startsWith('openAccept') ? 'Accept order' : act.label}</button>` : '';
  openDrawer(`
    <div class="ov-h"><h3><span class="tag" style="font-size:25px">${o.number}</span><span class="stagepill"><span class="d" style="background:${STAGE_COLOR[o.status]}"></span>${STATUS_LONG[o.status]}</span></h3><button type="button" class="close" onclick="closeModal()" aria-label="Close"></button></div>
    <div class="ov-b">
      <div class="steps">${steps.map(([l, t, by], i) => `<div class="step ${stepCls(i)}"><span class="o">${stepCls(i) === 'done' ? ic('check', 'sm') : ''}</span><b>${l}</b><small>${t ? hm(t) : '—'}${by && by.name ? '<br>' + esc(by.name) : ''}</small></div>`).join('')}</div>
      ${o.status === 'cancelled' ? `<div class="attn bad">${ic('x', 'sm')}<span>Cancelled</span></div>` : a ? `<div class="attn ${a.kind === 'bad' ? 'bad' : a.kind === 'calm' ? 'calm' : ''}">${ic(a.icon, 'sm')}<span>${esc(a.text)}</span></div>` : ''}
      <div id="modalMsg"></div>
      <div><p class="lbl">Guest</p><dl class="kv">
        <dt>Name</dt><dd>${esc(o.guestName)}</dd>
        ${o.guestEmail ? `<dt>Email</dt><dd>${esc(o.guestEmail)}</dd>` : ''}
        <dt>Room</dt><dd>${o.room ? esc(o.room) : '<span class="muted">Set when accepted</span>'}</dd>
        <dt>Laundry</dt><dd class="num">${o.items} items · ${loads} load${loads > 1 ? 's' : ''}</dd>
        <dt>Ready by</dt><dd>${o.pickupAt ? dayLabel(o.pickupAt) : '—'}</dd>
        ${o.status === 'new' ? `<dt>Paying</dt><dd>${esc(paymentPref(o))}</dd>` : ''}
      </dl>
      ${o.note ? `<div class="note" style="margin-top:10px">“${esc(o.note)}”</div>` : ''}</div>
      <div><p class="lbl">Money</p>
        <div class="money"><div><small>${o.status === 'new' ? 'Estimate' : 'Total'}</small><b>${moneyShort(total)}</b></div><div><small>Paid</small><b>${moneyShort(paid)}</b></div>
          <div class="${o.status !== 'new' && balanceOf(o) > 0 ? 'owe' : ''}"><small>Balance</small><b>${moneyShort(o.status === 'new' ? total : balanceOf(o))}</b></div></div>
        ${o.discount ? `<div class="meta" style="margin-top:8px"><span>${ic('tag', 'sm')}${esc(o.discount.code)} · ${money(o.discount.amount)} off ${money(o.listPrice)}</span></div>` : ''}
        <div class="ledger">${(o.payments || []).map(p => `<div class="meta"><span>${ic(p.method === 'card' ? 'card' : 'cash', 'sm')}${money(p.amount)} ${esc(p.method)}${p.by && p.by.name ? ' · ' + esc(p.by.name) : ''} · ${fmt(p.at)}</span></div>`).join('')}</div>
      </div>
      <div><p class="lbl">Messages with ${esc(firstName(o.guestName))}</p>
        <div class="thread">${msgs || '<span class="muted">No messages yet.</span>'}</div>
        ${can('messageGuests') ? `<form class="compose" onsubmit="return replyOrder(event,'${o.id}')"><input id="replyInput" placeholder="Reply to ${esc(firstName(o.guestName))}" autocomplete="off" required><button aria-label="Send">${ic('send', 'sm')}</button></form>` : ''}
      </div>
      <div id="cancelBox"></div>
      <details class="actlog"><summary>Activity (${(o.logs || []).length})</summary><div style="margin-top:8px;display:grid;gap:6px">${logs || '<p class="muted">No activity.</p>'}</div></details>
    </div>
    <div class="ov-f">
      ${more ? `<button type="button" class="ghost" onclick="toggleDrawerMore()">${ic('more', 'sm')}More</button>` : ''}
      <span class="grow"></span>
      ${o.status === 'ready' && o.paymentStatus !== 'paid' && !isLaundry() ? '<span class="ov-hint">Collect payment before pickup</span>' : ''}
      ${primary}
      ${state.drawer.more && more ? `<div class="menu" style="left:16px;bottom:64px">${more}</div>` : ''}
    </div>`);
}
window.toggleDrawerMore = () => { state.drawer.more = !state.drawer.more; drawDrawer(); };
window.askCancel = (id) => {
  state.drawer.more = false; drawDrawer();
  const o = state.drawer.o;
  $('#cancelBox').innerHTML = `<div class="confirm"><p><b>Cancel order ${o.number}?</b> It leaves the board. You can undo for a few seconds afterwards.</p>
    <input id="cancelReason" placeholder="Reason (optional), e.g. guest changed their mind" autocomplete="off">
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="small secondary" onclick="document.getElementById('cancelBox').innerHTML=''">Keep order</button><button type="button" class="small danger" onclick="cancelOrder('${id}')">Cancel order</button></div></div>`;
  const b = document.querySelector('.modal .ov-b'); if (b) b.scrollTop = b.scrollHeight;
  $('#cancelReason').focus();
};

// ---- accept: rooms as taps, a live price, quick pickup times ----
window.openAccept = async (id) => {
  const o = (state.orders || []).find(x => x.id === id) || await api('GET', `/orders/${id}`);
  state.acc = { id, o, room: o.room || '', items: o.items, priceEdit: false, price: '', reason: '', pickup: 'tmw', when: '', payNow: o.paymentTiming === 'now', method: o.paymentMethod === 'card' ? 'card' : 'cash', disc: '', errs: {} };
  drawAccept();
};
function pickupChoices() {
  const at = (days, h) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d; };
  const list = [];
  if (new Date().getHours() < 19) list.push(['tonight', 'Tonight 20:00', at(0, 20)]);
  list.push(['tmw', 'Tomorrow 18:00', at(1, 18)]);
  const d2 = at(2, 18); list.push(['2d', `${d2.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, 18:00`, d2]);
  return list;
}
function accTotals() {
  const A = state.acc, per = state.settings?.piecesPerLoad || 25, ppl = state.settings?.pricePerLoad || 0;
  const loads = Math.max(1, Math.ceil((Number(A.items) || 1) / per)), computed = round2m(loads * ppl);
  const base = A.priceEdit && A.price !== '' ? round2m(Number(A.price)) : computed;
  const d = (state.discounts || []).find(x => x.code === A.disc);
  const off = d ? round2m(Math.min(base, d.type === 'percent' ? base * d.value / 100 : d.value)) : 0;
  return { loads, computed, base, off, total: round2m(base - off) };
}
function drawAccept() {
  const A = state.acc, o = A.o, T = accTotals(), rooms = state.settings?.rooms || [];
  const req = state.settings?.requireRoomOnAccept;
  const discs = can('discount') ? usableDiscounts() : [];
  openSheet(`
    <div class="ov-h"><h3>Accept <span class="tag" style="font-size:23px">${o.number}</span></h3><button type="button" class="close" onclick="closeModal()" aria-label="Close"></button></div>
    <div class="ov-b">
      <p class="sub">${esc(o.guestName)} asked for ${o.items} items · ${esc(paymentPref(o))}</p>
      ${o.note ? `<div class="note">“${esc(o.note)}”</div>` : ''}
      <div id="acceptMsg"></div>
      <div class="field"><label>Room${req ? '' : ' <span class="muted">(optional)</span>'}</label>
        ${rooms.length ? `<div class="chips">${rooms.map(r => `<button type="button" aria-pressed="${A.room === r}" onclick="accSet('room', this.dataset.v)" data-v="${esc(r)}">${esc(r)}</button>`).join('')}</div>`
          : `<input id="accRoom" value="${esc(A.room)}" placeholder="e.g. Duafe" oninput="state.acc.room=this.value">`}
        ${A.errs.room ? `<span class="err">${A.errs.room}</span>` : ''}</div>
      <div class="field"><label for="accItems">Items counted at the desk</label>
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
          <div class="stepper"><button type="button" aria-label="One fewer" onclick="accSet('items', -1)">−</button><input id="accItems" class="num" inputmode="numeric" value="${A.items}" onchange="accSet('itemsTo', this.value)"><button type="button" aria-label="One more" onclick="accSet('items', 1)">+</button></div>
          <span class="help num">${T.loads} load${T.loads > 1 ? 's' : ''} at ${money(state.settings?.pricePerLoad)} · up to ${state.settings?.piecesPerLoad || 25} items each</span></div></div>
      <div class="calc"><div><small>Price</small><span class="amt">${moneyShort(T.total)}</span>${T.off ? `<small class="num">${moneyShort(T.base)} − ${esc(A.disc)} ${moneyShort(T.off)}</small>` : ''}</div>
        ${A.priceEdit ? '' : `<button type="button" class="link" onclick="accSet('priceEdit')">Change price</button>`}</div>
      ${A.priceEdit ? `<div class="field"><label for="accPrice">New price (${esc(cur())})</label><input id="accPrice" class="num" inputmode="decimal" value="${esc(A.price)}" oninput="state.acc.price=this.value;accReasonToggle()" onchange="drawAccept()">
        <div id="accReasonBox" class="${round2m(Number(A.price)) !== T.computed ? '' : 'hidden'}"><label for="accReason">Why the change?</label><input id="accReason" value="${esc(A.reason)}" placeholder="For example: express service, extra bedding" oninput="state.acc.reason=this.value"></div>
        ${A.errs.reason ? `<span class="err">${A.errs.reason}</span>` : ''}</div>` : ''}
      <div class="field"><label>Ready by</label><div class="chips">${pickupChoices().map(([k, l]) => `<button type="button" aria-pressed="${A.pickup === k}" onclick="accSet('pickup','${k}')">${l}</button>`).join('')}<button type="button" aria-pressed="${A.pickup === 'other'}" onclick="accSet('pickup','other')">Other time…</button></div>
        ${A.pickup === 'other' ? `<input id="accWhen" type="datetime-local" style="margin-top:8px" value="${esc(A.when || toLocalInput(new Date(Date.now() + 864e5).toISOString()))}" oninput="state.acc.when=this.value">` : ''}</div>
      ${discs.length ? `<div class="field"><label>Discount code</label><div class="chips">${discs.map(d => `<button type="button" aria-pressed="${A.disc === d.code}" onclick="accSet('disc', this.dataset.v)" data-v="${esc(d.code)}">${ic('tag', 'sm')} ${esc(d.code)} · ${d.type === 'percent' ? d.value + '%' : moneyShort(d.value)}</button>`).join('')}</div></div>` : ''}
      <button type="button" class="toggle-row" onclick="accSet('payNow')"><span><b>Collect payment now</b><small>${o.paymentTiming === 'now' ? 'The guest chose to pay now' : 'Otherwise they pay at pickup'}</small></span><i class="sw ${A.payNow ? 'on' : ''}"></i></button>
      ${A.payNow ? `<div class="tiles">${['cash', 'card'].map(m => `<button type="button" class="tile" aria-pressed="${A.method === m}" onclick="accSet('method','${m}')">${ic(m, 'lg')}<b>${m === 'cash' ? 'Cash' : 'Card'}</b></button>`).join('')}</div>` : ''}
    </div>
    <div class="ov-f"><button type="button" class="ghost" onclick="closeModal()">Not now</button><span class="grow"></span><button type="button" id="accGo" onclick="doAccept()">Accept${A.payNow ? ' & record ' + moneyShort(T.total) : ''}</button></div>`, 'accept-' + o.id);
}
window.accReasonToggle = () => { const box = $('#accReasonBox'); if (box) box.classList.toggle('hidden', round2m(Number(state.acc.price)) === accTotals().computed); };
window.accSet = (k, v) => {
  const A = state.acc;
  if (k === 'room') { A.room = v; delete A.errs.room; }
  if (k === 'items') A.items = Math.max(1, (Number(A.items) || 1) + v);
  if (k === 'itemsTo') A.items = Math.max(1, Math.floor(Number(v)) || 1);
  if (k === 'priceEdit') { A.priceEdit = true; A.price = String(accTotals().computed); }
  if (k === 'pickup') A.pickup = v;
  if (k === 'disc') A.disc = A.disc === v ? '' : v;
  if (k === 'payNow') A.payNow = !A.payNow;
  if (k === 'method') A.method = v;
  drawAccept();
  if (k === 'priceEdit') { const i = $('#accPrice'); if (i) { i.focus(); i.select(); } }
};
window.doAccept = async () => {
  const A = state.acc, T = accTotals(); A.errs = {};
  const room = String(A.room || '').trim();
  if (state.settings?.requireRoomOnAccept && !room) A.errs.room = 'Pick the guest’s room first.';
  if (A.priceEdit && T.base !== T.computed && !String(A.reason).trim()) A.errs.reason = 'Say why the price changed. It goes in the order log.';
  if (Object.keys(A.errs).length) return drawAccept();
  const pick = pickupChoices().find(p => p[0] === A.pickup);
  const pickupAt = A.pickup === 'other' ? (A.when ? new Date(A.when).toISOString() : null) : pick ? pick[2].toISOString() : null;
  const btn = $('#accGo'); if (btn) btn.disabled = true;
  try {
    await api('POST', `/orders/${A.id}/accept`, {
      room, items: A.items, pickupAt,
      price: A.priceEdit ? A.price : undefined, priceReason: String(A.reason || '').trim(),
      discountCode: A.disc || '',
      paymentStatus: A.payNow ? 'paid' : 'unpaid', paymentMethod: A.method,
    });
    closeModal(); state.movedId = A.id; await refreshShift(); renderTab();
    toast(`Accepted ${A.o.number}${A.payNow ? ` · ${moneyShort(T.total)} ${A.method} recorded` : ''}.`);
    setTimeout(() => { state.movedId = null; }, 1200);
  } catch (e) { if (btn) btn.disabled = false; notice($('#acceptMsg'), 'err', e.message); const b = document.querySelector('.modal .ov-b'); if (b) b.scrollTop = 0; }
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

// ---- moving orders on, with a few seconds to undo a wrong tap ----
window.advance = async (id) => {
  try {
    const o = await api('POST', `/orders/${id}/advance`, {});
    closeModal(); state.movedId = id; renderTab();
    const told = o.guestEmail ? ` ${firstName(o.guestName)} has been told.` : '';
    const msg = { cleaning: `${o.number} is in the wash.${told}`, ready: `${o.number} is ready for pickup.${told}`, completed: `${o.number} picked up.` }[o.status] || `${o.number} moved on.`;
    toast(msg, { undo: () => undoMove(id) });
    setTimeout(() => { if (state.movedId === id) state.movedId = null; }, 1200);
  } catch (e) {
    // A stale re-click on an order that's already picked up shouldn't alarm anyone.
    if (/already been picked up|already .*cancelled/i.test(e.message)) { closeModal(); renderTab(); }
    else toast(e.message, { err: true });
  }
};
async function undoMove(id) {
  const o = await api('POST', `/orders/${id}/undo`);
  state.movedId = id; await refreshShift(); renderTab();
  toast(`Undone. ${o.number} is back in ${STATUS_LONG[o.status]}.`);
  setTimeout(() => { if (state.movedId === id) state.movedId = null; }, 1200);
}
window.cancelOrder = async (id) => {
  const reason = $('#cancelReason') ? $('#cancelReason').value.trim() : '';
  try {
    const o = await api('POST', `/orders/${id}/cancel`, { reason });
    closeModal(); renderTab();
    toast(`${o.number} cancelled.`, { undo: () => undoMove(id) });
  } catch (e) { notice($('#modalMsg'), 'err', e.message); }
};
window.revert = async (id) => {
  try { const o = await api('POST', `/orders/${id}/revert`, {}); closeModal(); state.movedId = id; renderTab(); toast(`${o.number} moved back to ${STATUS_LONG[o.status]}.`); }
  catch (e) { toast(e.message, { err: true }); }
};
window.reportDelay = async (id) => {
  const reason = prompt('Reason for the delay (this mutes the reminder for 30 minutes, then it resumes if the order still hasn\'t moved):');
  if (reason === null || !reason.trim()) return;
  try { await api('POST', `/orders/${id}/delay-reason`, { reason: reason.trim() }); state._lastFollowUpPing = Date.now(); closeModal(); renderTab(); toast('Delay noted. Reminders pause for 30 minutes.'); }
  catch (e) { toast(e.message, { err: true }); }
};

// ---- take payment: the amount is the balance, the button says what gets recorded ----
window.takePayment = async (id) => {
  const o = await api('GET', `/orders/${id}`);
  state.pay = { id, o, method: o.paymentMethod === 'card' ? 'card' : 'cash', part: false, amt: String(balanceOf(o)) };
  drawPay();
};
function payAmount() { const P = state.pay, bal = balanceOf(P.o); return P.part ? Math.min(bal, Math.max(0, round2m(Number(P.amt) || 0))) : bal; }
function drawPay() {
  const P = state.pay, o = P.o, paid = Number(o.amountPaid) || 0, amt = payAmount(), loads = o.loads || 1;
  const discs = can('discount') && can('modifyAccepted') && !paid ? usableDiscounts(o.discount && o.discount.code) : [];
  const sh = state.shift && state.shift.open ? state.shift.shift : null;
  openSheet(`
    <div class="ov-h"><h3>Take payment</h3><button type="button" class="close" onclick="closeModal()" aria-label="Close"></button></div>
    <div class="ov-b">
      <div class="card-h" style="margin-top:-4px"><span class="tag">${o.number}</span><b>${esc(o.guestName)}</b>${o.room ? `<span class="room">${ic('door', 'sm')}${esc(o.room)}</span>` : ''}</div>
      <div id="payMsg"></div>
      <div class="calc"><div><small>${P.part ? 'Part payment' : 'Balance due'}</small><span class="amt" id="payBig">${money(amt)}</span>
        <small class="num">${paid ? `${money(paid)} already paid of ${money(o.price)}` : `${o.items} items · ${loads} load${loads > 1 ? 's' : ''}`}</small></div>
        ${can('partialPayment') ? `<button type="button" class="link" onclick="paySet('part')">${P.part ? 'Full balance' : 'Part payment'}</button>` : ''}</div>
      ${P.part ? `<div class="field"><label for="payAmount">Amount taken (${esc(cur())})</label><input id="payAmount" class="num" inputmode="decimal" value="${esc(P.amt)}" oninput="state.pay.amt=this.value;payRefresh()"></div>` : ''}
      <div class="field"><label>How did they pay?</label><div class="tiles">${['cash', 'card'].map(m => `<button type="button" class="tile" aria-pressed="${P.method === m}" onclick="paySet('method','${m}')">${ic(m, 'lg')}<b>${m === 'cash' ? 'Cash' : 'Card'}</b><small>${m === 'cash' ? 'Into the till' : 'On the card machine'}</small></button>`).join('')}</div></div>
      ${discs.length ? `<div class="field"><label>Discount code</label><div class="chips">${discs.map(d => `<button type="button" aria-pressed="${!!(o.discount && o.discount.code === d.code)}" onclick="payDiscount(this.dataset.v)" data-v="${esc(d.code)}">${ic('tag', 'sm')} ${esc(d.code)} · ${d.type === 'percent' ? d.value + '%' : moneyShort(d.value)}</button>`).join('')}</div></div>` : ''}
      <p class="muted" style="margin:0;font-size:13.5px;display:flex;gap:6px;align-items:center">${ic('staff', 'sm')}<span>Recorded as taken by <b style="color:var(--ink)">${esc(state.user.name)}</b>${sh ? ` in the ${sh.type} shift` : ''}.</span></p>
    </div>
    <div class="ov-f"><button type="button" class="ghost" onclick="closeModal()">Cancel</button><span class="grow"></span><button type="button" id="payGo" onclick="doPay()" ${amt > 0 ? '' : 'disabled'}>Record ${moneyShort(amt)} ${P.method}</button></div>`, 'pay-' + o.id);
}
window.payRefresh = () => { const amt = payAmount(); const big = $('#payBig'), go = $('#payGo'); if (big) big.textContent = money(amt); if (go) { go.textContent = `Record ${moneyShort(amt)} ${state.pay.method}`; go.disabled = !(amt > 0); } };
window.paySet = (k, v) => {
  const P = state.pay;
  if (k === 'method') P.method = v;
  if (k === 'part') { P.part = !P.part; P.amt = String(balanceOf(P.o)); }
  drawPay();
  if (k === 'part' && P.part) { const i = $('#payAmount'); if (i) { i.focus(); i.select(); } }
};
window.payDiscount = async (code) => {
  const P = state.pay, on = P.o.discount && P.o.discount.code === code;
  try { P.o = await api('PATCH', `/orders/${P.id}`, on ? { removeDiscount: true } : { discountCode: code }); P.amt = String(balanceOf(P.o)); drawPay(); }
  catch (e) { notice($('#payMsg'), 'err', e.message); }
};
window.doPay = async () => {
  const P = state.pay, amt = payAmount(), go = $('#payGo');
  if (!(amt > 0)) return;
  if (go) go.disabled = true;
  try {
    await api('POST', `/orders/${P.id}/pay`, { amount: amt, method: P.method });
    closeModal(); state.movedId = P.id; await refreshShift(); renderTab();
    toast(`${moneyShort(amt)} ${P.method} recorded for ${P.o.number}.`);
    setTimeout(() => { state.movedId = null; }, 1200);
  } catch (e) { if (go) go.disabled = false; notice($('#payMsg'), 'err', e.message); }
};
window.replyOrder = async (e, id) => {
  e.preventDefault();
  const t = $('#replyInput').value.trim(); if (!t) return false;
  try { await api('POST', `/orders/${id}/reply`, { text: t }); await openOrder(id); toast(`Sent to ${firstName(state.drawer.o.guestName)}.`); const b = document.querySelector('.modal .ov-b'); const th = document.querySelector('.modal .thread'); if (th && b) th.scrollIntoView({ block: 'nearest' }); }
  catch (err) { notice($('#modalMsg'), 'err', err.message); }
  return false;
};

// ---------------- MESSAGES ----------------
async function renderMessages(view, silent) {
  const threads = await api('GET', '/threads');
  const totalUnread = threads.reduce((a, t) => a + t.unread, 0);
  state.pendingMsg = totalUnread;
  setBadge('messages', totalUnread);
  view.innerHTML = `${totalUnread ? `<p class="hint"><span class="pill">${totalUnread} unread</span></p>` : ''}
    <div class="grid">${threads.map(t => `
      <article class="ocard" onclick="openOrder('${t.id}')" tabindex="0">
        <div class="top"><span class="tag">${t.number}</span><b style="font-weight:600">${esc(t.guestName)}</b>${t.unread ? `<span class="unread" style="margin-left:auto">${ic('msg', 'sm')}${t.unread}</span>` : ''}</div>
        <div class="note">${esc(t.lastMessage.sender === 'staff' ? 'You: ' : '')}${esc(t.lastMessage.text)}</div>
        <div class="meta"><span>${fmt(t.lastMessage.at)}</span><span class="badge b-${t.status}">${STATUS_LONG[t.status] || t.status}</span></div>
      </article>`).join('') || '<div class="empty">No messages yet. Guests can write to you from their tracking page.</div>'}</div>`;
}
function setBadge(tab, n) { const b = $('#badge-' + tab); if (!b) return; if (n > 0) { b.textContent = n; b.classList.remove('hidden'); } else b.classList.add('hidden'); }

// ---------------- REPORTS ----------------
const RANGE_PILLS = [['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['month', 'This month'], ['custom', 'Custom']];
const SHIFT_PILLS = [['', 'All shifts'], ['AM', 'AM'], ['PM', 'PM'], ['Night', 'Night']];
async function renderReports(view) {
  const today = new Date(); const p = n => String(n).padStart(2, '0');
  const toStr = d => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  state.rpOpen = state.rpOpen || null;
  view.innerHTML = `
    <div class="rhead">
      <div class="pills" id="rpRangePills">${RANGE_PILLS.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${v === 'today'}" onclick="setReportRange('${v}')">${l}</button>`).join('')}</div>
      <div class="pills" id="rpShiftPills">${SHIFT_PILLS.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${v === ''}" onclick="setReportShift('${v}')">${l}</button>`).join('')}</div>
      <span class="grow"></span>
      ${can('exportReports') ? `<button type="button" class="small secondary" onclick="exportCsv()">Export CSV</button><button type="button" class="small secondary" onclick="exportPdf()">Print / PDF</button>` : ''}
    </div>
    <div class="custom-range hidden" id="rpCustom" style="margin:-6px 0 16px">
      <input id="rpFrom" type="date" value="${toStr(today)}" onchange="onDateEdited()" aria-label="From">
      <span class="muted">to</span>
      <input id="rpTo" type="date" value="${toStr(today)}" onchange="onDateEdited()" aria-label="To">
      <button type="button" class="small" onclick="loadReport()">Show</button>
    </div>
    <select id="rpRange" class="hidden" aria-hidden="true" tabindex="-1">${RANGE_PILLS.map(([v]) => `<option value="${v}">${v}</option>`).join('')}<option value="15">15</option></select>
    <select id="rpShift" class="hidden" aria-hidden="true" tabindex="-1">${SHIFT_PILLS.map(([v]) => `<option value="${v}">${v}</option>`).join('')}</select>
    <div id="reportBody"><p class="muted">Loading…</p></div>`;
  loadReport();
}
function pressPill(groupId, v) { document.querySelectorAll(`#${groupId} button`).forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v)); }
window.setReportRange = (v) => {
  $('#rpRange').value = v; pressPill('rpRangePills', v);
  $('#rpCustom').classList.toggle('hidden', v !== 'custom');
  if (v !== 'custom') applyRange();
};
window.setReportShift = (v) => { $('#rpShift').value = v; pressPill('rpShiftPills', v); loadReport(); };
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
window.onDateEdited = () => { const r = $('#rpRange'); if (r) r.value = 'custom'; pressPill('rpRangePills', 'custom'); };
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
window.toggleShiftPays = (s) => { state.rpOpen = state.rpOpen === s ? null : s; if (window._report) drawReport(window._report); };
window.loadReport = async () => {
  const body = $('#reportBody'); if (!body) return;
  try {
    const r = await api('GET', '/report?' + reportQs());
    window._report = r;
    drawReport(r);
  } catch (e) { body.innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
};
function drawReport(r) {
  const t = r.totals, p = reportParams();
  const shifts = ['AM', 'PM', 'Night'];
  const maxCol = Math.max(1, ...shifts.map(s => r.byShift[s].collected));
  const maxRev = Math.max(1, ...r.byDay.map(d => d.revenue));
  $('#reportBody').innerHTML = `
    ${r.range.shift && r.range.shift !== 'all' ? `<p class="hint">Showing the <b>${esc(r.range.shift)}</b> shift only (${SHIFT_TIME[r.range.shift]}).</p>` : ''}
    <div class="kpis">
      <div class="stat"><div class="k">Revenue</div><div class="v">${moneyShort(t.revenue)}</div><div class="s">orders accepted in range</div></div>
      <div class="stat"><div class="k">Collected</div><div class="v">${moneyShort(t.collected)}</div><div class="s">by payment time</div></div>
      <div class="stat ${t.outstanding > 0 ? 'warn' : ''}"><div class="k">Outstanding</div><div class="v">${moneyShort(t.outstanding)}</div><div class="s">still owed</div></div>
      <div class="stat"><div class="k">Orders</div><div class="v">${t.orders}</div><div class="s">${t.paidCount ?? 0} paid · ${(t.partialCount ?? 0) + (t.unpaidCount ?? 0)} not yet</div></div>
    </div>
    <div class="minis">
      <span>Cash <b>${money(r.byMethod.cash)}</b></span><span>Card <b>${money(r.byMethod.card)}</b></span>
      <span>Loads <b>${t.loads}</b></span><span>Items <b>${t.items}</b></span><span>Average order <b>${money(t.avgOrderValue)}</b></span>
      ${t.discounts ? `<span>Discounts <b>−${money(t.discounts)}</b> on ${t.discountedCount} order${t.discountedCount === 1 ? '' : 's'}</span>` : ''}
    </div>
    <div class="panel"><h3>Collected by shift</h3>
      <p class="sub">Money counts in the shift it was taken in; revenue and loads count the shift the order was accepted in. Tap a shift for the payments behind it.</p>
      ${shifts.map(s => {
        const b = r.byShift[s], open = state.rpOpen === s, pays = (b.payments || []).slice().sort((x, y) => String(x.at).localeCompare(String(y.at)));
        return `<button type="button" class="shiftrow" aria-expanded="${open}" onclick="toggleShiftPays('${s}')">
            <span><b>${s}</b><small>${SHIFT_TIME[s]}</small></span>
            <span><span class="sbar">${b.collected ? `<i style="width:${b.cash / maxCol * 100}%;background:var(--cash)"></i><i style="width:${b.card / maxCol * 100}%;background:var(--card-pay)"></i>` : ''}</span>
              <small>${b.orders} order${b.orders === 1 ? '' : 's'} · ${moneyShort(b.revenue)} revenue · ${b.loads} load${b.loads === 1 ? '' : 's'}</small></span>
            <b class="num" style="text-align:right">${money(b.collected)}</b>${ic(open ? 'chev' : 'right', 'sm')}</button>
          ${open ? `<div class="paylist">${pays.length ? pays.map(x => `<div><span>${String(x.at).slice(11, 16)}</span><b>#${x.number}</b><span>${x.method === 'card' ? 'Card' : 'Cash'}${x.by ? ' · ' + esc(x.by) : ''}</span><b>${money(x.amount)}</b></div>`).join('') : '<div><span></span><span></span><span>No payments in this shift</span><span></span></div>'}</div>` : ''}`;
      }).join('')}
      <div class="legend"><span><i style="background:var(--cash)"></i>Cash</span><span><i style="background:var(--card-pay)"></i>Card</span></div>
    </div>
    <div class="panel"><h3>Revenue by day</h3><p class="sub">Orders accepted each day.</p>
      ${r.byDay.length ? r.byDay.map(d => `<div class="daybar"><span class="muted num">${d.date}</span><span class="bar"><i style="width:${(d.revenue / maxRev * 100).toFixed(1)}%"></i></span><span class="num" style="text-align:right">${money(d.revenue)}</span></div>`).join('') : '<p class="muted" style="margin:0">No revenue in this range.</p>'}
    </div>
    <div class="panel flush"><h3>By staff</h3><p class="sub">Payments, Collected, Cash and Card count the money each person took in this range, by payment time.</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>Staff</th><th class="r">Accepted</th><th class="r">Cleaned</th><th class="r">Ready</th><th class="r">Picked up</th><th class="r">Payments</th><th class="r">Collected</th><th class="r">Cash</th><th class="r">Card</th></tr></thead>
      <tbody>${(r.byStaff || []).map(s => `<tr><td><b>${esc(s.name)}</b></td><td class="r">${s.accepted}</td><td class="r">${s.cleaned}</td><td class="r">${s.ready}</td><td class="r">${s.completed}</td><td class="r">${s.payments}</td><td class="r">${money(s.collected)}</td><td class="r">${money(s.cash)}</td><td class="r">${money(s.card)}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">No activity</td></tr>'}</tbody></table></div></div>
    <div class="panel flush"><h3>Orders in range <span class="muted" style="font-weight:500">${r.orders.length}</span></h3>
      <div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Accepted</th><th>Shift</th><th>Guest</th><th>Room</th><th class="r">Loads</th><th class="r">Total</th><th>Discount</th><th>Payment</th><th>Accepted by</th><th>Ready by</th><th>Paid by</th><th>Status</th></tr></thead>
      <tbody>${r.orders.map(o => `<tr onclick="openOrder('${o.id}')"><td class="num">${o.number}</td><td>${fmt(o.acceptedAt || o.createdAt)}</td><td>${o.shift}</td><td>${esc(o.guestName)}</td><td>${esc(o.room || '—')}</td><td class="r">${o.loads}</td><td class="r">${money(o.price)}</td><td>${o.discount ? esc(o.discount.code) + ' −' + money(o.discount.amount) : '—'}</td><td>${o.paymentStatus === 'paid' ? 'Paid · ' + esc(o.paymentMethod || '') : o.paymentStatus === 'partial' ? 'Part paid' : 'Unpaid'}</td><td>${esc(nm(o.acceptedBy))}</td><td>${esc(nm(o.readyBy))}</td><td>${esc(nm(o.paidBy))}</td><td><span class="badge b-${o.status}">${STATUS_LONG[o.status] || o.status}</span></td></tr>`).join('') || '<tr><td colspan="13" class="muted">None</td></tr>'}</tbody></table></div></div>
    <div id="shiftHistory"></div>`;
  loadShiftHistory(p.from, p.to);
}
async function loadShiftHistory(from, to) {
  let shifts = [];
  try { shifts = await api('GET', `/shifts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); } catch { return; }
  const host = $('#shiftHistory'); if (!host || !shifts.length) return;
  host.innerHTML = `<div class="panel flush"><h3>Shift handovers</h3><p class="sub">Who opened and closed each shift, and what changed hands.</p>
    <div class="table-wrap"><table class="data"><thead><tr><th>Opened</th><th>By</th><th>Shift</th><th>Closed</th><th class="r">Received</th><th class="r">Paid</th><th class="r">Picked up</th><th class="r">In progress</th><th>Area checked</th><th>Status</th></tr></thead>
    <tbody>${shifts.map(s => { const a = s.activity || {}; return `<tr><td>${fmt(s.openedAt)}</td><td>${esc(s.cashierName)}</td><td>${s.type}</td><td>${s.closedAt ? fmt(s.closedAt) : '—'}</td><td class="r">${a.received ? a.received.count : '—'}</td><td class="r">${a.payments ? money(a.payments.total) : '—'}</td><td class="r">${a.pickedUp ? a.pickedUp.count : '—'}</td><td class="r">${s.closingInProgress != null ? s.closingInProgress : '—'}</td><td>${s.acknowledged ? 'Yes' : '—'}</td><td>${s.status === 'open' ? '<span class="pill">open</span>' : 'closed'}</td></tr>`; }).join('')}</tbody></table></div></div>`;
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
  view.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><p class="hint" style="margin:0">Everyone who signs in, and what each person may do.</p><button onclick="openCashier()">+ Add staff</button></div>
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
      <option value="housekeeping" ${c && c.role === 'housekeeping' ? 'selected' : ''}>Housekeeping (linen only)</option>
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
  cashier: { acceptOrders: true, advanceStatus: true, takePayment: true, messageGuests: true, linenCheckout: true },
  laundry: { advanceStatus: true, linenWash: true },
  housekeeping: { linenUse: true },
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
  view.innerHTML = `
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
function openModal(html, cls = '') {
  $('#modalHost').innerHTML = `<div class="modal-bg ${cls.includes('drawer') ? 'drawer-bg' : ''}" onclick="if(event.target===this)closeModal()"><div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div></div>`;
}
// A sheet that redraws in place (taps on chips, steppers) keeps its scroll and doesn't re-animate.
function openSheet(html, key, cls = 'sheet') {
  const cur = $('#modalHost').querySelector('.modal');
  if (cur && cur.dataset.key === key) {
    const b = cur.querySelector('.ov-b'), top = b ? b.scrollTop : 0;
    cur.innerHTML = html;
    const b2 = cur.querySelector('.ov-b'); if (b2) b2.scrollTop = top;
    return;
  }
  openModal(html, cls);
  $('#modalHost').querySelector('.modal').dataset.key = key;
}
function openDrawer(html) { openSheet(html, 'order-' + (state.drawer && state.drawer.id), 'sheet drawer'); }
window.closeModal = () => { $('#modalHost').innerHTML = ''; };

// Test hooks (harmless in production).
window.__test = { state, renderShiftEndBanner, checkShiftBoundary, currentShiftType };

boot();
