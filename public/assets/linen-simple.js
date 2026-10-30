// Staff linen screens: big picture buttons, scan-only steps, no typing.
//
// Housekeeping and laundry staff see these in place of the full Linen tab;
// supervisors open them from Linen → Staff screens. Each job is a few screens:
// pick a big tile, then scan. The phone works out what each scan means (a piece
// from this bed is coming off, a clean piece is going on, a piece from the wash
// is folded), flashes the whole screen green or orange with the item's picture,
// and only asks a question when something is missing. Anything staff can't
// settle goes to the supervisor's "Needs checking" list.
//
// Uses linen.js (LN, lnPic, lnType, lnPlaces, lnPlaceDue, lnDetector) and
// app.js (api, can, state, esc, fmt).
'use strict';

const LS = {
  screen: 'home', room: null, bed: null, off: [], on: [], ask: [], mode: 'clean', folded: {}, batchId: null,
  picked: null, have: 0, cam: null, flashT: null, busy: false, msg: '',
};
window.LS = LS;

// Screens with the camera running.
const LS_SCAN = ['room', 'bedscan', 'cuproom', 'cupscan', 'dmgscan', 'fold'];

const LS_ICON = {
  bed: '<svg width="46" height="46" viewBox="0 0 48 48" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 38V12M5 28h38v10M43 28v-4a6 6 0 0 0-6-6H22v10"/><circle cx="13" cy="22" r="4"/></svg>',
  cupboard: '<svg width="46" height="46" viewBox="0 0 48 48" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="5" width="30" height="38" rx="3"/><path d="M24 5v38M19 22v4M29 22v4"/></svg>',
  torn: '<svg width="46" height="46" viewBox="0 0 48 48" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M24 5L3 42h42z"/><path d="M24 18v11M24 35v1"/></svg>',
  machine: '<svg width="46" height="46" viewBox="0 0 48 48" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="4" width="34" height="40" rx="4"/><circle cx="24" cy="27" r="10"/><path d="M13 11h6"/></svg>',
  fold: '<svg width="46" height="46" viewBox="0 0 48 48" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="30" width="36" height="10" rx="3"/><rect x="9" y="19" width="30" height="10" rx="3"/><rect x="12" y="8" width="24" height="10" rx="3"/></svg>',
  back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  speaker: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/></svg>',
  tick: '<svg width="70" height="70" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  cross: '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  door: '<svg width="64" height="64" viewBox="0 0 48 48" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="11" y="5" width="26" height="38" rx="2"/><circle cx="31" cy="25" r="1.6" fill="#fff"/></svg>',
  clean: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" style="stroke:var(--good-solid)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  again: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" style="stroke:var(--accent-2)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/></svg>',
  dmg: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" style="stroke:var(--warn-solid)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3L2 21h20z"/><path d="M12 10v5M12 18v.5"/></svg>',
};
const LS_REASONS = {
  torn: ['Torn', 'damaged', '<svg width="58" height="58" viewBox="0 0 64 64"><rect x="8" y="14" width="48" height="36" rx="5" fill="#9fb3ad"/><path d="M30 14l6 9-7 6 8 8-5 13" stroke="#fff" stroke-width="5" fill="none" stroke-linejoin="round"/></svg>'],
  stain: ['Stain', 'damaged', '<svg width="58" height="58" viewBox="0 0 64 64"><rect x="8" y="14" width="48" height="36" rx="5" fill="#9fb3ad"/><path d="M27 24c6-4 14 0 13 7s-4 3-6 9-11 4-12-2 0-11 5-14z" fill="#7a4a1d"/></svg>'],
  burn: ['Burn', 'damaged', '<svg width="58" height="58" viewBox="0 0 64 64"><rect x="8" y="14" width="48" height="36" rx="5" fill="#9fb3ad"/><ellipse cx="32" cy="32" rx="10" ry="8" fill="#2b2b2b"/><ellipse cx="32" cy="32" rx="5" ry="3.5" fill="#6b3b14"/></svg>'],
  thin: ['Worn thin', 'worn', '<svg width="58" height="58" viewBox="0 0 64 64"><rect x="8" y="14" width="48" height="36" rx="5" fill="#c9d6d2"/><circle cx="22" cy="26" r="3" fill="#fff"/><circle cx="40" cy="38" r="4" fill="#fff"/><circle cx="34" cy="24" r="2" fill="#fff"/><circle cx="20" cy="40" r="2.5" fill="#fff"/></svg>'],
};
const LS_ROOM_COLORS = ['#2f6fd6', '#1f9d55', '#c2410c', '#6d4bb8', '#0e7490', '#be185d', '#a16207', '#4d7c0f'];

// ------------------------------------------------------------------ shell ---
async function renderLinenSimple(view) {
  lsCamStop(); // the screen is rebuilt below, video element and all
  if (!LN.doc) LN.doc = await api('GET', '/linen');
  view.innerHTML = `<div class="ls-wrap"><div class="ls-screen" id="lsScreen">
    <div id="lsTop"></div>
    <div class="ls-cam" id="lsCam" hidden><video playsinline muted></video><div class="ls-aim"></div><div class="ls-cammsg" id="lsCamMsg">Point the camera at a label</div></div>
    <div class="ls-body" id="lsBody"></div><div class="ls-foot" id="lsFoot"></div><div id="lsFlash"></div>
  </div></div>`;
  lsDraw();
}
async function lsReload() { LN.doc = await api('GET', '/linen'); }
function lsGo(screen, patch = {}) { Object.assign(LS, patch, { screen, msg: '' }); lsDraw(); }
window.lsGo = lsGo;
function lsHome() { lsGo('home', { room: null, bed: null, off: [], on: [], ask: [], picked: null, mode: 'clean' }); }
window.lsHome = lsHome;

function lsDraw() {
  if (!document.getElementById('lsScreen')) return;
  lsTypeClose();
  const s = (LS_SCREENS[LS.screen] || LS_SCREENS.home)();
  $('#lsTop').innerHTML = s.top || '';
  $('#lsBody').innerHTML = s.body || '';
  $('#lsFoot').innerHTML = s.foot || '';
  $('#lsFoot').hidden = !s.foot;
  if (LS_SCAN.includes(LS.screen)) lsCamStart(); else lsCamStop();
}

function lsBar(title, back) {
  const n = state.user?.name || '';
  return `<div class="ls-bar">${back ? `<button class="ls-back" onclick="${back}" aria-label="Back">${LS_ICON.back}</button>` : ''}
    <h2>${title ? esc(title) : `Hello, ${esc(n)}`}</h2></div>`;
}
function lsListen(text) { return `<button class="ls-listen" onclick="lsSay(this.dataset.t)" data-t="${esc(text)}">${LS_ICON.speaker} Listen</button>`; }
window.lsSay = (t) => {
  try { const u = new SpeechSynthesisUtterance(t); u.rate = 0.9; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch {}
};
function lsSlot(typeId, cls, code) {
  return `<div class="ls-slot ${cls}">${lnPic(typeId, 48)}<div class="nm">${esc(lnTypeName(typeId))}</div>${code && cls === 'got' ? `<div class="cd">${code}</div>` : ''}</div>`;
}
function lsRoomColor(name) { const i = LN.doc.rooms.findIndex((r) => r.name === name); return LS_ROOM_COLORS[(i < 0 ? 0 : i) % LS_ROOM_COLORS.length]; }

// ---------------------------------------------------------------- feedback ---
function lsFlash(ok, typeId, big, small) {
  const host = $('#lsFlash');
  if (!host) return;
  host.innerHTML = `<div class="ls-flash ${ok ? 'ok' : 'no'}" role="status">${typeId ? `<div class="pic">${lnPic(typeId, 110)}</div>` : ''}${ok ? '' : LS_ICON.cross}<b>${esc(big)}</b><span>${esc(small || '')}</span></div>`;
  lnBeep(ok);
  try { navigator.vibrate && navigator.vibrate(ok ? 60 : [120, 80, 120]); } catch {}
  clearTimeout(LS.flashT);
  LS.flashT = setTimeout(() => { if ($('#lsFlash')) $('#lsFlash').innerHTML = ''; }, ok ? 900 : 1900);
}
function lsBusy() { return $('#lsFlash') && $('#lsFlash').innerHTML; }

// ----------------------------------------------------------------- camera ---
// Runs inside the screen (not over it) while a scan screen is open, so the
// pictures stay in view. Stops itself when the screen goes away.
async function lsCamStart() {
  const box = $('#lsCam');
  box.hidden = false;
  if (LS.cam && LS.cam.alive) {
    const v = box.querySelector('video');
    if (v.srcObject !== LS.cam.stream) { v.srcObject = LS.cam.stream; v.play().catch(() => {}); }
    return;
  }
  const msg = $('#lsCamMsg');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg.textContent = 'No camera here. Use the scanner, or tap "Type a code".'; return; }
  LS.cam = { alive: true, stream: null, last: '', lastAt: 0 };
  const cam = LS.cam;
  try { cam.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); }
  catch { cam.alive = false; msg.textContent = 'Camera is blocked. Allow the camera, or tap "Type a code".'; return; }
  if (!cam.alive) { cam.stream.getTracks().forEach((t) => t.stop()); return; }
  const video = box.querySelector('video');
  video.srcObject = cam.stream; await video.play().catch(() => {});
  let detect;
  try { detect = await lnDetector(video); } catch (e) { msg.textContent = e.message; return; }
  msg.textContent = 'Point the camera at a label';
  const loop = async () => {
    const live = document.getElementById('lsCam');
    if (!cam.alive || !live || live.hidden) return lsCamStop();
    const v = live.querySelector('video');
    try {
      const code = v === video ? await detect() : null;
      if (code && (code !== cam.last || Date.now() - cam.lastAt > 2500) && !lsBusy()) {
        cam.last = code; cam.lastAt = Date.now();
        lsScan(code);
      }
    } catch {}
    setTimeout(loop, 180);
  };
  loop();
}
function lsCamStop() {
  const box = document.getElementById('lsCam');
  if (box) box.hidden = true;
  if (!LS.cam) return;
  LS.cam.alive = false;
  if (LS.cam.stream) LS.cam.stream.getTracks().forEach((t) => t.stop());
  LS.cam = null;
}
window.lsCamStop = lsCamStop;

// A handheld scanner types the code fast and presses Enter.
let _lsKeys = '', _lsKeyAt = 0;
document.addEventListener('keydown', (e) => {
  if (!document.getElementById('lsScreen') || !LS_SCAN.includes(LS.screen)) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  const now = Date.now();
  if (now - _lsKeyAt > 120) _lsKeys = '';
  _lsKeyAt = now;
  if (e.key === 'Enter') { if (_lsKeys.length >= 4) { e.preventDefault(); lsScan(_lsKeys); } _lsKeys = ''; return; }
  if (e.key.length === 1) _lsKeys += e.key;
});
// No camera or scanner to hand: type just the number on the label. Matching
// pieces show as you type, the ones that fit this job first; one tap picks it.
window.lsType = () => {
  let box = document.getElementById('lsTypeBox');
  if (!box) { box = document.createElement('div'); box.id = 'lsTypeBox'; $('#lsScreen').appendChild(box); }
  box.innerHTML = `<div class="ls-type">
    <div class="ls-type-h"><b>Type the number on the label</b><button class="ls-back" onclick="lsTypeClose()" aria-label="Close">${LS_ICON.cross.replace(/stroke="#fff"/, 'stroke="currentColor"').replace(/width="56" height="56"/, 'width="22" height="22"')}</button></div>
    <input id="lsTypeIn" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="e.g. 42" aria-label="Number on the label">
    <div id="lsTypeList" class="ls-type-list"></div></div>`;
  const inp = $('#lsTypeIn');
  inp.oninput = () => { inp.value = inp.value.replace(/[^0-9]/g, ''); lsTypeList(inp.value); };
  inp.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = lsSuggest(inp.value)[0];
    if (first && Number(first.code.slice(1)) === Number(inp.value)) lsTypePick(first.code);
  };
  lsTypeList('');
  setTimeout(() => inp.focus(), 30);
};
window.lsTypeClose = () => { const b = document.getElementById('lsTypeBox'); if (b) b.remove(); };
window.lsTypePick = (code) => { lsTypeClose(); lsScan(code); };
// How likely a piece is to be the one meant, on this screen (lower is likelier).
function lsRank(p) {
  if (p.status === 'retired') return 9;
  if (LS.screen === 'bedscan') {
    if (lsOnPlace().some((x) => x.code === p.code)) return LS.off.includes(p.code) ? 8 : 0;
    if (LS.on.includes(p.code)) return 8;
    if (p.status === 'clean') return lsNeedList().includes(p.typeId) ? 1 : 3;
    return 5;
  }
  if (LS.screen === 'cupscan') return LS.on.includes(p.code) ? 8 : p.status === 'clean' && p.loc !== LS.room ? (lsCupNeed()[p.typeId] ? 0 : 2) : 5;
  if (LS.screen === 'fold') { const b = lsBatch(); return b && b.codes.includes(p.code) ? (LS.folded[p.code] ? 8 : 0) : 5; }
  return p.status === 'washing' ? 5 : 1;
}
function lsSuggest(digits) {
  const want = digits ? Number(digits) : null;
  return LN.doc.pieces
    .map((p) => ({ p, n: Number(p.code.slice(1)), r: lsRank(p) }))
    .filter((x) => x.r < 8 && (!digits || String(x.n).startsWith(digits)))
    .sort((a, b) => (b.n === want) - (a.n === want) || a.r - b.r || a.n - b.n)
    .slice(0, digits ? 6 : 5).map((x) => x.p);
}
function lsTypeList(digits) {
  const list = lsSuggest(digits);
  $('#lsTypeList').innerHTML = (digits ? '' : '<p class="ls-type-hint">Or tap one:</p>') + (list.map((p) => `
    <button class="ls-type-row" onclick="lsTypePick('${p.code}')">${lnPic(p.typeId, 44)}
      <span><b>${esc(lnTypeName(p.typeId))}</b><span class="cd">${p.code.replace(/^L0*/, 'No. ')}</span><small>${esc(LN_STATUS[p.status][0])} · ${esc(lnWhere(p))}</small></span></button>`).join('')
    || `<p class="ls-type-hint">No piece has number ${esc(digits)}. Check the label.</p>`);
}

// --------------------------------------------------------------- scanning ---
function lsScan(raw) {
  if (typeof resetIdle === 'function') resetIdle(); // camera scans aren't taps; keep the session open
  const text = String(raw || '').trim();
  const room = text.match(/^ROOM:(.+)$/i);
  if (room) return lsScanRoom(room[1].trim());
  const p = lnPiece(lnCode(text));
  if (!p) return lsFlash(false, null, 'Not one of ours', 'This label is not in the system. Give it to the supervisor.');
  const fn = LS_ON_SCAN[LS.screen];
  if (!fn) return lsFlash(false, p.typeId, lnTypeName(p.typeId), 'Choose a job first.');
  fn(p);
}
window.lsScan = lsScan;
function lsScanRoom(name) {
  const r = LN.doc.rooms.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!r) return lsFlash(false, null, 'Unknown room', name);
  if (LS.screen === 'cuproom' || LS.screen === 'cupscan') {
    if (!r.cupboard) return lsFlash(false, null, `${r.name}`, 'This room has no cupboard yet.');
    lsFlash(true, null, r.name, 'Cupboard');
    return lsGo('cupscan', { room: r.name, on: [] });
  }
  if (LS.screen === 'room' || LS.screen === 'bed' || LS.screen === 'home') {
    lsFlash(true, null, r.name, 'Which bed?');
    return lsGo('bed', { room: r.name });
  }
  lsFlash(false, null, r.name, 'Finish this job first.');
}

// What a scan means on each screen.
const LS_ON_SCAN = {
  room(p) { lsFlash(false, p.typeId, 'Scan the room card', 'Or tap the room.'); },
  cuproom(p) { lsFlash(false, p.typeId, 'Scan the cupboard card', 'Or tap the room.'); },
  bedscan(p) {
    const name = lnTypeName(p.typeId);
    if (LS.off.includes(p.code) || LS.on.includes(p.code)) return lsFlash(false, p.typeId, 'Already done', 'You scanned this one.');
    const cur = lsOnPlace().map((x) => x.code);
    if (cur.includes(p.code)) { LS.off.push(p.code); lsFlash(true, p.typeId, 'Off ✓', `${name} into the dirty bag`); return lsDraw(); }
    if (p.status === 'clean' || p.status === 'missing') {
      const need = lsNeedList().filter((t) => t === p.typeId).length;
      const have = LS.on.filter((c) => lnPiece(c).typeId === p.typeId).length;
      if (have >= need) return lsFlash(false, p.typeId, need ? 'Enough already' : 'Not for this one', need ? `It has all its ${name.toLowerCase()}s.` : `This doesn't take a ${name.toLowerCase()}.`);
      LS.on.push(p.code); lsFlash(true, p.typeId, p.status === 'missing' ? 'Found it! On ✓' : 'On ✓', name); return lsDraw();
    }
    if (p.status === 'soiled') return lsFlash(false, p.typeId, 'This one is dirty', 'Put it in the wash bag.');
    if (p.status === 'washing') return lsFlash(false, p.typeId, 'This one is in the wash', 'Give it to the laundry.');
    if (p.status === 'in_use') return lsFlash(false, p.typeId, 'This is on another bed', `${p.room}. Put it back.`);
    return lsFlash(false, p.typeId, 'Do not use this one', 'It was taken out of stock. Give it to the supervisor.');
  },
  cupscan(p) {
    const name = lnTypeName(p.typeId);
    if (LS.on.includes(p.code)) return lsFlash(false, p.typeId, 'Already done', 'You scanned this one.');
    if (p.status !== 'clean') return lsFlash(false, p.typeId, p.status === 'soiled' ? 'This one is dirty' : 'Not this one', 'Only clean linen goes in the cupboard.');
    if (p.loc === LS.room) return lsFlash(false, p.typeId, 'Already in this cupboard', name);
    const need = lsCupNeed()[p.typeId] || 0;
    const have = LS.on.filter((c) => lnPiece(c).typeId === p.typeId).length + lsCupHave(p.typeId);
    if (have >= need) return lsFlash(false, p.typeId, need ? 'Enough already' : 'Not needed here', need ? `The cupboard has all its ${name.toLowerCase()}s.` : `This room doesn't use ${name.toLowerCase()}s.`);
    LS.on.push(p.code); lsFlash(true, p.typeId, 'In ✓', name); lsDraw();
  },
  dmgscan(p) {
    if (p.status === 'retired') return lsFlash(false, p.typeId, 'Already reported', 'Put it in the red bag.');
    if (p.status === 'washing') return lsFlash(false, p.typeId, 'This one is in the wash', 'Tap "Damaged" when you fold it.');
    lsFlash(true, p.typeId, lnTypeName(p.typeId), 'What is wrong with it?');
    lsGo('dmgwhy', { picked: p.code });
  },
  fold(p) {
    const b = lsBatch();
    const name = lnTypeName(p.typeId);
    if (!b) return lsFlash(false, p.typeId, 'Nothing is in the wash', '');
    if (!b.codes.includes(p.code)) {
      if (p.status === 'washing') return lsFlash(false, p.typeId, 'From a later wash', 'Finish this wash first. Put it to one side.');
      if (p.status === 'soiled') return lsFlash(false, p.typeId, 'Not washed yet', 'This one is still in the dirty bin.');
      return lsFlash(false, p.typeId, 'Not from this wash', 'Put it to one side for the supervisor.');
    }
    if (LS.folded[p.code]) return lsFlash(false, p.typeId, 'Already done', 'You scanned this one.');
    LS.folded[p.code] = LS.mode;
    lsSaveFold();
    const words = { clean: ['Clean ✓', `${name} to the shelf`], again: ['Wash again', `${name} back in the dirty bin`], dmg: ['Damaged', `${name}: put it in the red bag`] }[LS.mode];
    lsFlash(true, p.typeId, words[0], words[1]);
    lsDraw();
  },
};

// -------------------------------------------------------------------- data ---
function lsPlace() { return lnPlaces().find((pl) => pl.room.name === LS.room && (pl.bedId || null) === (LS.bed || null)); }
function lsOnPlace() { return LN.doc.pieces.filter((p) => p.status === 'in_use' && p.room === LS.room && (p.bed || null) === (LS.bed || null)); }
function lsNeedList() {
  const pl = lsPlace(); const out = [];
  if (pl) Object.entries(pl.set).forEach(([t, k]) => { for (let i = 0; i < k; i++) out.push(t); });
  return out;
}
function lsPlaceTitle() { const pl = lsPlace(); return pl ? `${LS.room} · ${pl.label}` : LS.room; }
function lsCupNeed() {
  const r = LN.doc.rooms.find((x) => x.name === LS.room);
  return r ? lnRoomChange(r) : {};
}
function lsCupHave(typeId) { return LN.doc.pieces.filter((p) => p.status === 'clean' && p.loc === LS.room && p.typeId === typeId).length; }
// The wash to fold: the oldest one still out.
function lsBatch() {
  const list = LN.doc.batches.filter((b) => b.status === 'washing').sort((a, b) => String(a.sentAt).localeCompare(String(b.sentAt)));
  return list[0] || null;
}
// Folding a big wash takes a while: keep the scans on this phone until it's finished.
function lsSaveFold() { try { const b = lsBatch(); if (b) localStorage.setItem('ls-fold-' + b.id, JSON.stringify(LS.folded)); } catch {} }
function lsLoadFold() { try { const b = lsBatch(); LS.folded = b ? JSON.parse(localStorage.getItem('ls-fold-' + b.id) || '{}') : {}; } catch { LS.folded = {}; } }

// -------------------------------------------------------------------- jobs ---
async function lsSend(fn, onErr) {
  if (LS.busy) return;
  LS.busy = true;
  try { await fn(); } catch (e) { LS.busy = false; lsFlash(false, null, 'That did not save', e.message); if (onErr) onErr(); return; }
  LS.busy = false;
}
window.lsFinishBed = (sure) => {
  const notOff = lsOnPlace().filter((p) => !LS.off.includes(p.code));
  if (notOff.length && !sure) return lsGo('bedask', { ask: notOff.map((p) => p.code) });
  lsSend(async () => {
    await api('POST', '/linen/change', { room: LS.room, bed: LS.bed, off: LS.off, on: LS.on });
    await lsReload();
    lsGo('beddone');
  });
};
window.lsFinishCup = () => lsSend(async () => {
  await api('POST', '/linen/move', { codes: LS.on, to: LS.room });
  await lsReload();
  lsGo('cupdone');
});
window.lsDamage = (key) => lsSend(async () => {
  const [label, reason] = LS_REASONS[key];
  await api('POST', '/linen/retire', { codes: [LS.picked], reason, note: label });
  await lsReload();
  lsGo('dmgdone');
});
window.lsWashAll = () => lsSend(async () => {
  const codes = LN.doc.pieces.filter((p) => p.status === 'soiled').map((p) => p.code);
  await api('POST', '/linen/wash', { codes });
  await lsReload();
  lsGo('washdone');
});
window.lsFinishFold = (sure) => {
  const b = lsBatch();
  const left = b.codes.filter((c) => !LS.folded[c] && lnPiece(c) && lnPiece(c).status === 'washing');
  if (left.length && !sure) return lsGo('foldask', { ask: left });
  const pick = (m) => Object.keys(LS.folded).filter((c) => LS.folded[c] === m && b.codes.includes(c));
  lsSend(async () => {
    await api('POST', `/linen/batches/${b.id}/receive`, { back: pick('clean'), rewash: pick('again'), damaged: pick('dmg'), loc: 'store', note: 'Damaged in the wash' });
    try { localStorage.removeItem('ls-fold-' + b.id); } catch {}
    LS.folded = {};
    await lsReload();
    lsGo('folddone');
  });
};
window.lsMode = (m) => { LS.mode = m; lsDraw(); };
window.lsPickRoom = (i, cup) => { const r = LN.doc.rooms[i]; cup ? lsGo('cupscan', { room: r.name, on: [] }) : lsGo('bed', { room: r.name }); };
window.lsPickPlace = (i) => { const pl = lnPlaces().filter((x) => x.room.name === LS.room)[i]; lsGo('bedscan', { bed: pl.bedId, off: [], on: [], ask: [] }); };
window.lsOpenFold = () => { lsLoadFold(); lsGo('fold', { mode: 'clean' }); };

// ----------------------------------------------------------------- screens ---
const lsTypeLink = '<button class="ls-link" onclick="lsType()">Type the number</button>';
const LS_SCREENS = {
  home() {
    const tiles = [];
    if (can('linenUse')) {
      const due = lnPlaces().filter(lnPlaceDue).length;
      tiles.push(`<button class="ls-tile t-teal" onclick="lsGo('room')"><span class="ic">${LS_ICON.bed}</span><span>Change a bed<small>${due ? `${due} to do` : 'Sheets, pillowcases, towels'}</small></span></button>`);
      tiles.push(`<button class="ls-tile t-blue" onclick="lsGo('cuproom')"><span class="ic">${LS_ICON.cupboard}</span><span>Fill a cupboard<small>Clean linen into a room</small></span></button>`);
    }
    if (can('linenWash')) {
      const bin = LN.doc.pieces.filter((p) => p.status === 'soiled').length;
      const b = lsBatch();
      tiles.push(`<button class="ls-tile t-blue" onclick="lsGo('wash')"><span class="ic">${LS_ICON.machine}</span><span>Wash the dirty bin<small>${bin} piece${bin === 1 ? '' : 's'} waiting</small></span></button>`);
      tiles.push(`<button class="ls-tile t-teal" onclick="lsOpenFold()"><span class="ic">${LS_ICON.fold}</span><span>Fold clean linen<small>${b ? `${b.codes.length} pieces in the wash` : 'Nothing in the wash'}</small></span></button>`);
    }
    if (can('linenUse') || can('linenWash')) tiles.push(`<button class="ls-tile t-red" onclick="lsGo('dmgscan')"><span class="ic">${LS_ICON.torn}</span><span>Something is damaged<small>Torn, stained, burnt</small></span></button>`);
    return { top: lsBar('', null), body: `<p class="ls-say">What are you doing?</p><div class="ls-tiles">${tiles.join('') || '<p>No linen jobs are set up for you. Ask the supervisor.</p>'}</div>` };
  },
  room() {
    return {
      top: lsBar('Which room?', 'lsHome()'),
      body: `${lsListen('Scan the card on the room door, or tap the room.')}
        <div class="ls-rooms">${LN.doc.rooms.map((r, i) => {
          const pls = lnPlaces().filter((pl) => pl.room === r);
          const due = pls.filter(lnPlaceDue);
          const gone = pls.filter((pl) => lnPlaceDue(pl) === 'checkout').length;
          const flag = gone ? `Guest left · ${gone}` : due.length ? `${due.length} to do` : '';
          return `<button class="ls-room ${flag ? 'due' : ''}" onclick="lsPickRoom(${i})"><span class="sw" style="background:${lsRoomColor(r.name)}"></span><b>${esc(r.name)}</b>${flag ? `<span class="flag">● ${flag}</span>` : `<span class="sub">${r.beds.length} bed${r.beds.length === 1 ? '' : 's'}</span>`}</button>`;
        }).join('') || '<p>No rooms yet. Ask the supervisor.</p>'}</div>`,
    };
  },
  bed() {
    const pls = lnPlaces().filter((pl) => pl.room.name === LS.room);
    return {
      top: lsBar(LS.room, "lsGo('room')"),
      body: `${(() => { const r = LN.doc.rooms.find((x) => x.name === LS.room); return r && r.alt ? `<p class="ls-p">Booked as <b>${esc(lnBookedAs(r))}</b></p>` : ''; })()}<p class="ls-say">Which one?</p><div class="ls-rooms">${pls.map((pl, i) => {
        const due = lnPlaceDue(pl);
        const d = lnDays(pl.changedAt);
        const sub = pl.kind === 'sofa' ? (due ? 'Make it a sofa' : 'Sofa') : due === 'stripped' ? 'Not made' : due === 'checkout' ? 'Guest left' : due === 'booking' ? `Now ${lnBookedAs(pl.room)}` : d === 0 ? 'Done today' : d != null ? `${d} day${d === 1 ? '' : 's'}` : '';
        return `<button class="ls-room ${due ? 'due' : ''}" onclick="lsPickPlace(${i})" ${pl.kind === 'sofa' && !due ? 'disabled' : ''}><span class="sw" style="background:${lsRoomColor(LS.room)}"></span><b>${esc(pl.label)}</b><span class="${due ? 'flag' : 'sub'}">${due ? '● ' : ''}${esc(sub)}</span></button>`;
      }).join('')}</div>`,
    };
  },
  bedscan() {
    const cur = lsOnPlace();
    const need = lsNeedList();
    const left = [...LS.on];
    const onSlots = need.map((t) => { const i = left.findIndex((c) => lnPiece(c).typeId === t); return i >= 0 ? lsSlot(t, 'got', left.splice(i, 1)[0]) : lsSlot(t, 'empty'); });
    left.forEach((c) => onSlots.push(lsSlot(lnPiece(c).typeId, 'got', c)));
    const full = LS.on.length >= need.length;
    return {
      top: lsBar(lsPlaceTitle(), "lsGo('bed')"),
      body: `${lsListen('Scan everything you take off. Then scan each clean piece you put on.')}
        ${cur.length ? `<div class="ls-h"><b>1. Take off</b><span>${LS.off.length} of ${cur.length}</span></div>
          <div class="ls-slots">${cur.map((p) => lsSlot(p.typeId, LS.off.includes(p.code) ? 'got' : 'empty', p.code)).join('')}</div>` : ''}
        <div class="ls-h"><b>${cur.length ? '2. ' : ''}Put on</b><span>${LS.on.length} of ${need.length}</span></div>
        <div class="ls-slots">${onSlots.join('') || (lsPlace() && lsPlace().kind === 'sofa' ? '<p class="ls-p">Nothing goes on. It is a sofa now.</p>' : '<p>Nothing is set up for this one. Ask the supervisor.</p>')}</div>
        ${cur.length ? '<button class="ls-link" onclick="lsStripOnly()">Leave it empty, make it later</button>' : ''}`,
      foot: `<button class="ls-big" onclick="lsFinishBed()" ${full && (need.length || cur.length) ? '' : 'disabled'}>${full ? 'Done' : 'Scan the clean pieces'}</button>${lsTypeLink}`,
    };
  },
  bedask() {
    return {
      top: lsBar('One thing', "lsGo('bedscan')"),
      body: `<p class="ls-say">We could not find ${LS.ask.length > 1 ? 'these' : 'this'}:</p>
        <div class="ls-slots">${LS.ask.map((c) => lsSlot(lnPiece(c).typeId, 'miss', c)).join('')}</div>
        <p class="ls-p">Look under the bed and the pillows, and in the bathroom.</p>`,
      foot: `<button class="ls-big" onclick="lsGo('bedscan')">I found it, scan it</button><button class="ls-big alt" onclick="lsFinishBed(true)">It is not here</button>`,
    };
  },
  beddone() {
    return {
      top: lsBar('', null),
      body: `<div class="ls-done"><div class="ring">${LS_ICON.tick}</div><h3>${LS.on.length ? 'Done' : lsPlace() && lsPlace().kind === 'sofa' ? 'Sofa ready' : 'Bed stripped'}</h3>
        <p>${esc(lsPlaceTitle())}${LS.ask.length ? '. The supervisor will look for the missing piece.' : '.'}</p>
        <div class="mini">${LS.on.map((c) => lnPic(lnPiece(c).typeId, 36)).join('')}</div></div>`,
      foot: `<button class="ls-big" onclick="lsGo('bed',{off:[],on:[],ask:[]})">Next in ${esc(LS.room)}</button><button class="ls-big alt" onclick="lsHome()">Home</button>`,
    };
  },
  cuproom() {
    const any = LN.doc.rooms.some((r) => r.cupboard);
    return {
      top: lsBar('Which cupboard?', 'lsHome()'),
      body: any ? `${lsListen('Scan the card in the cupboard, or tap the room.')}
        <div class="ls-rooms">${LN.doc.rooms.map((r, i) => `<button class="ls-room" onclick="lsPickRoom(${i},true)" ${r.cupboard ? '' : 'disabled'}><span class="sw" style="background:${lsRoomColor(r.name)}"></span><b>${esc(r.name)}</b><span class="sub">${r.cupboard ? 'Cupboard' : 'No cupboard yet'}</span></button>`).join('')}</div>`
        : '<p class="ls-say">No room has a cupboard yet.</p><p class="ls-p">Clean linen stays in the storeroom for now.</p>',

    };
  },
  cupscan() {
    const need = lsCupNeed();
    const slots = [];
    let total = 0, got = 0;
    Object.entries(need).forEach(([t, k]) => {
      const there = lsCupHave(t);
      const scanned = LS.on.filter((c) => lnPiece(c).typeId === t);
      for (let i = 0; i < k; i++) {
        total++;
        if (i < there) { got++; slots.push(lsSlot(t, 'got')); }
        else if (scanned[i - there]) { got++; slots.push(lsSlot(t, 'got', scanned[i - there])); }
        else slots.push(lsSlot(t, 'empty'));
      }
    });
    return {
      top: lsBar(`${LS.room} cupboard`, "lsGo('cuproom')"),
      body: `${lsListen('Take clean linen from the storeroom. Scan each piece as you put it in the cupboard.')}
        <div class="ls-h"><b>One full change</b><span>${got} of ${total}</span></div><div class="ls-slots">${slots.join('')}</div>`,
      foot: `<button class="ls-big" onclick="lsFinishCup()" ${LS.on.length ? '' : 'disabled'}>Done</button>${lsTypeLink}`,
    };
  },
  cupdone() {
    return { top: lsBar('', null), body: `<div class="ls-done"><div class="ring">${LS_ICON.tick}</div><h3>Cupboard filled</h3><p>${LS.on.length} pieces in the ${esc(LS.room)} cupboard.</p></div>`, foot: '<button class="ls-big" onclick="lsHome()">Home</button>' };
  },
  dmgscan() {
    return { top: lsBar('Damaged', 'lsHome()'), body: `${lsListen('Scan the damaged piece.')}<p class="ls-say">Scan the damaged piece.</p>`, foot: lsTypeLink };
  },
  dmgwhy() {
    const p = lnPiece(LS.picked);
    return {
      top: lsBar('What is wrong?', "lsGo('dmgscan')"),
      body: `<div class="ls-picked">${lnPic(p.typeId, 56)}<b>${esc(lnTypeName(p.typeId))}</b></div>
        <div class="ls-reasons">${Object.entries(LS_REASONS).map(([k, [l, , svg]]) => `<button onclick="lsDamage('${k}')">${svg}${l}</button>`).join('')}</div>`,
    };
  },
  dmgdone() {
    return { top: lsBar('', null), body: `<div class="ls-done"><div class="ring warn">${LS_ICON.tick}</div><h3>Thank you</h3><p>Put it in the red bag. The supervisor will check it.</p></div>`, foot: '<button class="ls-big" onclick="lsHome()">Home</button>' };
  },
  wash() {
    const bin = LN.doc.pieces.filter((p) => p.status === 'soiled');
    const by = {}; bin.forEach((p) => { by[p.typeId] = (by[p.typeId] || 0) + 1; });
    return {
      top: lsBar('Dirty bin', 'lsHome()'),
      body: `${lsListen('Put everything from the dirty bin in the machine, then tap the green button.')}
        ${bin.length ? Object.entries(by).map(([t, k]) => `<div class="ls-count"><span>${lnPic(t, 52)}</span><b>${esc(lnTypeName(t))}</b><span class="num">${k}</span></div>`).join('') : '<p class="ls-say">The dirty bin is empty.</p>'}`,
      foot: `<button class="ls-big" onclick="lsWashAll()" ${bin.length ? '' : 'disabled'}>All in the machine</button>`,
    };
  },
  washdone() {
    return { top: lsBar('', null), body: `<div class="ls-done"><div class="ring">${LS_ICON.tick}</div><h3>Washing</h3><p>When it is dry, tap "Fold clean linen" and scan each piece as you fold it.</p></div>`, foot: '<button class="ls-big" onclick="lsHome()">Home</button>' };
  },
  fold() {
    const b = lsBatch();
    if (!b) return { top: lsBar('Fold and scan', 'lsHome()'), body: '<p class="ls-say">Nothing is in the wash.</p>', foot: '<button class="ls-big" onclick="lsHome()">Home</button>' };
    const by = {};
    b.codes.forEach((c) => { const p = lnPiece(c); if (!p) return; by[p.typeId] = by[p.typeId] || { n: 0, done: 0 }; by[p.typeId].n++; if (LS.folded[c]) by[p.typeId].done++; });
    const done = Object.keys(LS.folded).filter((c) => b.codes.includes(c)).length;
    return {
      top: lsBar('Fold and scan', 'lsHome()'),
      body: `${lsListen('Scan each piece as you fold it. If it needs washing again, or it is damaged, tap the button first.')}
        ${Object.entries(by).map(([t, v]) => `<div class="ls-count ${v.done === v.n ? 'full' : ''}"><span>${lnPic(t, 52)}</span><b>${esc(lnTypeName(t))}</b><span class="num">${v.done}<small> / ${v.n}</small></span></div>`).join('')}`,
      foot: `<div class="ls-modes">
          <button class="m-clean ${LS.mode === 'clean' ? 'on' : ''}" onclick="lsMode('clean')">${LS_ICON.clean}Clean</button>
          <button class="m-again ${LS.mode === 'again' ? 'on' : ''}" onclick="lsMode('again')">${LS_ICON.again}Wash again</button>
          <button class="m-dmg ${LS.mode === 'dmg' ? 'on' : ''}" onclick="lsMode('dmg')">${LS_ICON.dmg}Damaged</button></div>
        <button class="ls-big" onclick="lsFinishFold()" ${done ? '' : 'disabled'}>Finished folding</button>${lsTypeLink}`,
    };
  },
  foldask() {
    return {
      top: lsBar('Not back yet', "lsGo('fold')"),
      body: `<p class="ls-say">${LS.ask.length} piece${LS.ask.length > 1 ? 's are' : ' is'} not back:</p>
        <div class="ls-slots">${LS.ask.map((c) => lsSlot(lnPiece(c).typeId, 'miss', c)).join('')}</div>
        <p class="ls-p">Look on the drying line, in the machine and on the trolley.</p>`,
      foot: `<button class="ls-big" onclick="lsGo('fold')">I found it, scan it</button><button class="ls-big alt" onclick="lsFinishFold(true)">Tell the supervisor</button>`,
    };
  },
  folddone() {
    const more = lsBatch();
    return {
      top: lsBar('', null),
      body: `<div class="ls-done"><div class="ring">${LS_ICON.tick}</div><h3>All folded</h3><p>Put the clean linen on the storeroom shelf.</p></div>`,
      foot: `${more ? '<button class="ls-big" onclick="lsOpenFold()">Fold the next wash</button>' : ''}<button class="ls-big ${more ? 'alt' : ''}" onclick="lsHome()">Home</button>`,
    };
  },
};
window.lsStripOnly = () => { LS.on = []; lsFinishBed(); };
