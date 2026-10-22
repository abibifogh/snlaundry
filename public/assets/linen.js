// The Linen tab: bed linen and towels, tracked piece by piece.
//
// Every piece carries a QR label with its code (L00001 …). Staff scan with the
// phone camera, a handheld scanner (it types the code and presses Enter) or by
// typing. The server keeps the record; this file draws it and sends the moves.
//
// Loaded after app.js and uses its helpers: api, can, state, esc, fmt, money,
// notice, openModal, closeModal.
'use strict';

const LN = {
  doc: null,
  sub: 'overview',
  roomFilter: 'all',
  loc: 'store',
  pieceFilter: { status: '', type: '', loc: '', q: '' },
  range: 'month',
  scan: {}, // scan field id → handler
  chg: null, rcv: null, send: null, cnt: null, mv: null, dmg: null,
  draft: null,
  lastCodes: [],
};

window.LN = LN; // inline handlers and tests reach the tab's state through it

const LN_STATUS = {
  clean: ['Clean', 'ln-ok'], in_use: ['In use', 'ln-blue'], soiled: ['Soiled', 'ln-amber'],
  washing: ['In the wash', 'ln-violet'], missing: ['Missing', 'ln-bad'], retired: ['Out of stock', 'ln-mute'],
};
const LN_REASONS = { damaged: 'Damaged', worn: 'Worn out', lost: 'Lost', charged: 'Charged to guest' };

function lnCanSee() { return ['linenUse', 'linenWash', 'linenCheckout', 'linenManage'].some(can); }

const LN_SUBS = [
  { id: 'overview', label: 'Overview', show: () => true },
  { id: 'review', label: 'Needs checking', show: () => can('linenManage'), badge: () => lnReviewList().length },
  { id: 'staff', label: 'Staff screens', show: () => can('linenManage') },
  { id: 'rooms', label: 'Rooms', show: () => can('linenUse') || can('linenCheckout') || can('linenManage') },
  { id: 'wash', label: 'Wash', show: () => can('linenWash') || can('linenManage') },
  { id: 'stock', label: 'Storeroom & cupboards', show: () => can('linenUse') || can('linenManage') },
  { id: 'pieces', label: 'Pieces', show: () => true },
  { id: 'reports', label: 'Losses & reorder', show: () => can('linenManage') },
  { id: 'activity', label: 'Activity', show: () => true },
  { id: 'setup', label: 'Setup', show: () => can('linenManage') },
];

// Housekeeping and laundry staff get the simple picture screens (linen-simple.js);
// supervisors and admins get the full tab, and can open the staff screens too.
function lnSimpleMode() { return ['housekeeping', 'laundry'].includes(state.user?.role); }

async function renderLinen(view) {
  LN.doc = await api('GET', '/linen');
  if (lnSimpleMode()) return renderLinenSimple(view);
  const subs = LN_SUBS.filter((s) => s.show());
  if (!subs.find((s) => s.id === LN.sub)) LN.sub = 'overview';
  view.innerHTML = `<div class="ln-subnav">${subs.map((s) => { const n = s.badge ? s.badge() : 0;
    return `<button class="${s.id === LN.sub ? 'active' : ''}" onclick="lnGo('${s.id}')">${s.label}${n ? `<span class="tab-badge">${n}</span>` : ''}</button>`; }).join('')}</div><div id="lnView"></div>`;
  const v = $('#lnView');
  if (LN.sub === 'staff') return renderLinenSimple(v);
  ({ overview: lnOverview, review: lnReview, rooms: lnRooms, wash: lnWash, stock: lnStock, pieces: lnPieces, reports: lnReports, activity: lnActivity, setup: lnSetup })[LN.sub](v);
}
// Coming into Setup starts a fresh draft; re-drawing Setup keeps the edits.
window.lnGo = (sub) => { if (sub === 'setup' && LN.sub !== 'setup') LN.draft = null; LN.sub = sub; renderLinen($('#view')).catch((e) => lnErr(e)); };
async function lnReload() { await renderLinen($('#view')); }
function lnErr(e) { const v = $('#view'); if (v) v.insertAdjacentHTML('afterbegin', `<div class="notice err">${esc(e.message)}</div>`); }

// ------------------------------------------------------------------ data ---
function lnType(id) { return LN.doc.types.find((t) => t.id === id) || { id, name: id, category: 'bed', cost: 0, washLife: 200 }; }
function lnTypeName(id) { return lnType(id).name; }
function lnPiece(code) { return LN.doc.pieces.find((p) => p.code === code); }
function lnColor(id) { return lnType(id).color || '#64748b'; }
// A simple drawing of each item, in its colour, for staff screens and labels.
function lnPic(typeId, size = 56) {
  const t = lnType(typeId), c = lnColor(typeId);
  const n = `${t.id} ${t.name}`.toLowerCase();
  const kind = /pillow|pcase/.test(n) ? 'pillow' : /floor|mat|ftowel/.test(n) ? 'mat' : /hand|htowel/.test(n) ? 'hand' : t.category === 'bath' || /towel/.test(n) ? 'towel' : /big|king|queen|bsheet/.test(n) ? 'big' : 'sheet';
  const shapes = {
    sheet: `<rect x="8" y="14" width="48" height="36" rx="5" fill="${c}"/><rect x="8" y="14" width="48" height="11" rx="5" fill="#fff" opacity=".35"/><path d="M8 32h48M8 41h48" stroke="#fff" stroke-width="2" opacity=".55"/>`,
    big: `<rect x="4" y="12" width="56" height="40" rx="5" fill="${c}"/><rect x="4" y="12" width="56" height="12" rx="5" fill="#fff" opacity=".35"/><path d="M4 30h56M4 38h56M4 46h56" stroke="#fff" stroke-width="2" opacity=".55"/>`,
    pillow: `<path d="M10 22c0-6 4-9 10-9h24c6 0 10 3 10 9v20c0 6-4 9-10 9H20c-6 0-10-3-10-9z" fill="${c}"/><path d="M14 20c6 3 30 3 36 0" stroke="#fff" stroke-width="2.4" fill="none" opacity=".7"/>`,
    towel: `<rect x="10" y="10" width="44" height="44" rx="6" fill="${c}"/><rect x="10" y="40" width="44" height="7" fill="#fff" opacity=".7"/><path d="M14 16h36" stroke="#fff" stroke-width="2" opacity=".5"/>`,
    hand: `<rect x="18" y="16" width="28" height="34" rx="5" fill="${c}"/><rect x="18" y="38" width="28" height="5" fill="#fff" opacity=".75"/>`,
    mat: `<rect x="6" y="20" width="52" height="26" rx="6" fill="${c}"/><rect x="11" y="25" width="42" height="16" rx="3" fill="none" stroke="#fff" stroke-width="2.4" opacity=".7"/>`,
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">${shapes[kind]}</svg>`;
}
function lnLocName(loc) { return loc === 'store' ? 'Storeroom' : `${loc} cupboard`; }
function lnDays(iso) { return iso ? Math.floor((Date.now() - new Date(iso)) / 86400000) : null; }
function lnHours(iso) { return iso ? (Date.now() - new Date(iso)) / 3600000 : 0; }
function lnCupboards() { return LN.doc.rooms.filter((r) => r.cupboard); }
function lnLocOptions(sel) {
  return [['store', 'Storeroom'], ...lnCupboards().map((r) => [r.name, `${r.name} cupboard`])]
    .map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
}
function lnStatusTag(p) { const [l, c] = LN_STATUS[p.status] || [p.status, 'ln-mute']; return `<span class="ln-tag ${c}">${l}</span>`; }
function lnWhere(p) {
  if (p.status === 'clean') return lnLocName(p.loc);
  if (p.status === 'in_use') {
    const r = LN.doc.rooms.find((x) => x.name === p.room);
    const b = r && p.bed ? r.beds.find((x) => x.id === p.bed) : null;
    return `${p.room} · ${b ? b.label : 'towels'}`;
  }
  if (p.status === 'washing') { const b = LN.doc.batches.find((x) => x.id === p.batchId); return b ? b.number : 'Wash'; }
  if (p.status === 'missing') return p.missingFrom || 'Unknown';
  if (p.status === 'retired') return (LN_REASONS[p.retiredReason] || '') + (p.note ? ` · ${p.note}` : '');
  return 'Soiled bin';
}

// Every bed and every room's towels is a "place" with a set of pieces.
function lnPlaces() {
  const out = [];
  LN.doc.rooms.forEach((r, ri) => {
    r.beds.forEach((b, bi) => out.push({ ri, bi, room: r, label: b.label, kind: 'bed', size: b.size, set: LN.doc.bedSets[b.size] || {}, state: b.state, changedAt: b.changedAt, bedId: b.id }));
    if (Object.keys(r.towels || {}).length) out.push({ ri, bi: -1, room: r, label: 'Towels', kind: 'bath', set: r.towels, state: r.towelsState, changedAt: r.towelsChangedAt, bedId: null });
  });
  return out;
}
function lnPlaceDue(pl) {
  if (pl.state !== 'made') return 'stripped';
  if (pl.room.checkoutAt && (!pl.changedAt || pl.changedAt < pl.room.checkoutAt)) return 'checkout';
  const limit = pl.kind === 'bath' ? LN.doc.towelChangeDays : LN.doc.bedChangeDays;
  const d = lnDays(pl.changedAt);
  if (d != null && d >= limit) return 'old';
  return '';
}
function lnNeedPerType() {
  const need = {};
  lnPlaces().forEach((pl) => Object.entries(pl.set).forEach(([k, n]) => { need[k] = (need[k] || 0) + n; }));
  return need;
}
function lnCountBy(pred) {
  const c = {};
  LN.doc.pieces.forEach((p) => { if (pred(p)) c[p.typeId] = (c[p.typeId] || 0) + 1; });
  return c;
}
function lnTotals() {
  const t = { clean: 0, in_use: 0, soiled: 0, washing: 0, missing: 0, retired: 0 };
  LN.doc.pieces.forEach((p) => { t[p.status] = (t[p.status] || 0) + 1; });
  return t;
}
function lnActive(p) { return p.status !== 'retired' && p.status !== 'missing'; }
function lnTypesInUse() {
  const need = lnNeedPerType();
  return LN.doc.types.filter((t) => t.active || need[t.id] || LN.doc.pieces.some((p) => p.typeId === t.id && p.status !== 'retired'));
}

// --------------------------------------------------------------- scanning ---
function lnScanField(id, placeholder = 'Scan or type a code, then Enter') {
  return `<div class="ln-scan"><input id="${id}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${placeholder}">
    <button type="button" class="secondary small" onclick="lnCamera('${id}')">📷 Camera</button></div><div id="${id}Msg" class="ln-scanmsg"></div>`;
}
function lnBindScan(id, handler) {
  LN.scan[id] = handler;
  const el = document.getElementById(id);
  if (!el) return;
  el.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = el.value.trim().toUpperCase(); el.value = '';
    if (v) lnHandleCode(id, v);
  };
  // Keep the field ready for a handheld scanner, but don't pop the phone keyboard.
  if (!_lnCam && !(window.matchMedia && matchMedia('(pointer: coarse)').matches)) setTimeout(() => el.focus(), 30);
}
function lnHandleCode(id, code) {
  // A QR may hold a URL or text around the code; take the code out of it.
  const m = String(code).toUpperCase().match(/L\d{5,}/);
  const c = m ? m[0] : String(code).toUpperCase();
  let res;
  try { res = LN.scan[id](c); } catch (e) { res = { err: e.message }; }
  const msg = document.getElementById(id + 'Msg'); // after the handler: it may have redrawn the modal
  if (msg) msg.innerHTML = res && res.err ? `<span class="ln-bad-text">✕ ${esc(res.err)}</span>` : `<span class="ln-ok-text">✓ ${esc((res && res.ok) || c)}</span>`;
  lnBeep(!(res && res.err));
  return res;
}
function lnBeep(good) {
  try {
    const ctx = (typeof _audioCtx !== 'undefined' && _audioCtx) || (window._lnAudio = window._lnAudio || new (window.AudioContext || window.webkitAudioContext)());
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = good ? 1200 : 220; o.type = good ? 'sine' : 'square';
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (good ? 0.09 : 0.25));
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.3);
  } catch {}
}

// Camera scanning: the browser's own barcode detector where there is one
// (Android Chrome), otherwise jsQR, loaded the first time it's needed.
let _lnCam = null;
function lnLoadJsQR() {
  if (window.jsQR) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = '/assets/vendor/jsQR.js';
    s.onload = res; s.onerror = () => rej(new Error("Couldn't load the QR reader. Type the code instead."));
    document.head.appendChild(s);
  });
}
// Reads a QR code from a playing <video>: returns an async function that gives
// the code it sees, or null.
async function lnDetector(video) {
  if ('BarcodeDetector' in window) {
    const bd = new window.BarcodeDetector({ formats: ['qr_code'] });
    return async () => { const r = await bd.detect(video); return r[0] && r[0].rawValue; };
  }
  await lnLoadJsQR();
  const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
  return async () => {
    if (!window.jsQR || !video.videoWidth) return null;
    cv.width = video.videoWidth; cv.height = video.videoHeight;
    cx.drawImage(video, 0, 0);
    const r = window.jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
    return r && r.data;
  };
}
window.lnCamera = async (id) => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return alert('This device has no camera access here. Type the code instead.');
  const ov = document.createElement('div');
  ov.className = 'ln-cam';
  ov.innerHTML = `<div class="ln-cam-box"><video playsinline muted></video><div class="ln-cam-aim"></div>
    <div class="ln-cam-msg">Point the camera at a label</div><button class="btn-full" onclick="lnCameraStop()">Done</button></div>`;
  document.body.appendChild(ov);
  const video = ov.querySelector('video'), msg = ov.querySelector('.ln-cam-msg');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch {
    msg.textContent = 'Camera not available. Allow camera access, or type the code.'; return;
  }
  video.srcObject = stream; await video.play().catch(() => {});
  let detect;
  try { detect = await lnDetector(video); } catch (e) { msg.textContent = e.message; detect = async () => null; }
  _lnCam = { stream, ov, alive: true, last: '', lastAt: 0 };
  const loop = async () => {
    if (!_lnCam || !_lnCam.alive) return;
    try {
      const v = await detect();
      if (v && (v !== _lnCam.last || Date.now() - _lnCam.lastAt > 2500)) {
        _lnCam.last = v; _lnCam.lastAt = Date.now();
        const r = lnHandleCode(id, v);
        msg.innerHTML = r && r.err ? `<span style="color:#fecaca">✕ ${esc(r.err)}</span>` : `✓ ${esc((r && r.ok) || v)}`;
      }
    } catch {}
    setTimeout(loop, 180);
  };
  loop();
};
window.lnCameraStop = () => {
  if (!_lnCam) return;
  _lnCam.alive = false;
  _lnCam.stream.getTracks().forEach((t) => t.stop());
  _lnCam.ov.remove(); _lnCam = null;
};

// ----------------------------------------------------------------- labels ---
// Opens a printable sheet of QR labels: code, item and property name.
function lnPrintLabels(codes) {
  if (!codes.length) return;
  const w = window.open('', '_blank');
  if (!w) return alert('Allow pop-ups for this site to print labels.');
  const tmp = document.createElement('div');
  const labels = codes.map((c) => {
    const p = lnPiece(c);
    let src = '';
    if (window.QRCode) {
      tmp.innerHTML = '';
      new QRCode(tmp, { text: c, width: 160, height: 160, correctLevel: QRCode.CorrectLevel.M });
      const cvs = tmp.querySelector('canvas');
      src = cvs ? cvs.toDataURL('image/png') : '';
    }
    return `<div class="l" style="border-left:3mm solid ${p ? lnColor(p.typeId) : '#999'}"><img src="${src}" alt=""><div><b>${c}</b><span>${p ? lnPic(p.typeId, 22) : ''} ${esc(p ? lnTypeName(p.typeId) : '')}</span><small>${esc(state.settings?.hostelName || '')}</small></div></div>`;
  }).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Linen labels</title><style>
    body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:8mm}
    .g{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}
    .l{display:flex;gap:3mm;align-items:center;border:1px dashed #bbb;border-radius:2mm;padding:2.5mm;break-inside:avoid}
    .l img{width:22mm;height:22mm}
    .l b{display:block;font-size:15pt;letter-spacing:.5pt;font-family:ui-monospace,Menlo,monospace}
    .l span{display:flex;align-items:center;gap:1mm;font-size:9pt}.l small{display:block;font-size:7pt;color:#666}
    p{font-size:10pt;color:#555}@media print{p{display:none}}
  </style></head><body><p>${codes.length} label(s). Print on sticker paper, or on paper and sew/iron into a corner of each piece. Use wash-proof labels for linen.</p>
  <div class="g">${labels}</div><script>setTimeout(function(){window.print()},400)<\/script></body></html>`);
  w.document.close();
}
window.lnPrintCodes = (codes) => lnPrintLabels(codes);

// A card for each room door (and cupboard): scanning it opens that room on the
// staff screens, so nobody has to find the room in a list.
window.lnPrintRoomCards = () => {
  const rooms = LN.doc.rooms;
  if (!rooms.length) return alert('Add rooms first.');
  const w = window.open('', '_blank');
  if (!w) return alert('Allow pop-ups for this site to print room cards.');
  const tmp = document.createElement('div');
  const cards = rooms.map((r) => {
    let src = '';
    if (window.QRCode) {
      tmp.innerHTML = '';
      new QRCode(tmp, { text: 'ROOM:' + r.name, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M });
      const cvs = tmp.querySelector('canvas'); src = cvs ? cvs.toDataURL('image/png') : '';
    }
    return `<div class="c"><img src="${src}" alt=""><b>${esc(r.name)}</b><span>Scan to open this room</span></div>`;
  }).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Room cards</title><style>
    body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:10mm}
    .g{display:grid;grid-template-columns:repeat(2,1fr);gap:8mm}
    .c{border:1px dashed #bbb;border-radius:4mm;padding:6mm;text-align:center;break-inside:avoid}
    .c img{width:50mm;height:50mm}.c b{display:block;font-size:24pt;margin-top:3mm}.c span{font-size:11pt;color:#555}
    p{font-size:10pt;color:#555}@media print{p{display:none}}
  </style></head><body><p>Stick one on each room door, and one inside each linen cupboard.</p><div class="g">${cards}</div>
  <script>setTimeout(function(){window.print()},400)<\/script></body></html>`);
  w.document.close();
};

// ------------------------------------------------------------- needs checking ---
// What staff couldn't settle: missing pieces, and damage they reported.
function lnReviewList() {
  if (!LN.doc) return [];
  return LN.doc.pieces.filter((p) => p.status === 'missing' || (p.status === 'retired' && p.checked === false))
    .sort((a, b) => String(b.statusAt).localeCompare(String(a.statusAt)));
}
function lnReview(v) {
  const list = lnReviewList();
  v.innerHTML = `
    <div class="ln-head"><div><h2>Needs checking</h2><p class="hint">Missing pieces and damage reported by staff. They carry on working; you settle each one here.</p></div></div>
    <div class="ln-review">${list.map((p) => {
      const missing = p.status === 'missing';
      const acts = missing
        ? `<button class="small" onclick="lnRevFound('${p.code}')">Found</button><button class="small secondary" onclick="lnRevRetire('${p.code}','lost')">Lost</button><button class="small secondary" onclick="lnRevRetire('${p.code}','charged')">Charge guest</button>`
        : `<button class="small secondary" onclick="lnRevDamaged('${p.code}',true)">Still usable</button><button class="small danger" onclick="lnRevDamaged('${p.code}',false)">Out of stock</button>`;
      return `<div class="ln-rev"><span>${lnPic(p.typeId, 52)}</span>
        <div><b>${esc(lnTypeName(p.typeId))}</b> <a href="#" class="ln-code" onclick="lnOpenPiece('${p.code}');return false">${p.code}</a>
        <div class="muted" style="font-size:13px">${missing ? esc(p.missingFrom || 'Missing') : `Reported ${esc((LN_REASONS[p.retiredReason] || '').toLowerCase())}${p.note ? ': ' + esc(p.note) : ''}`} · ${fmt(p.statusAt)}</div></div>
        <div class="ln-rev-acts">${acts}</div></div>`;
    }).join('') || '<div class="card"><p class="muted" style="margin:0">Nothing to check.</p></div>'}</div>`;
}
window.lnRevFound = async (code) => { try { await api('POST', '/linen/found', { codes: [code], as: 'soiled' }); await lnReload(); } catch (e) { alert(e.message); } };
window.lnRevRetire = async (code, reason) => {
  if (!confirm(`${code}: ${reason === 'lost' ? 'write off as lost' : 'charge to the guest'}?`)) return;
  try { await api('POST', '/linen/retire', { codes: [code], reason, note: '' }); await lnReload(); } catch (e) { alert(e.message); }
};
window.lnRevDamaged = async (code, usable) => { try { await api('POST', '/linen/check-damaged', { code, usable }); await lnReload(); } catch (e) { alert(e.message); } };

// --------------------------------------------------------------- overview ---
function lnOverview(v) {
  const d = LN.doc;
  if (!d.rooms.length || !d.pieces.length) {
    v.innerHTML = `<div class="card"><h2>Bed linen & towels</h2>
      <p class="hint">Nothing is set up yet. ${can('linenManage') ? 'Start in <b>Setup</b>: add your rooms and beds, then add your linen and print a label for each piece.' : 'An admin needs to add the rooms and linen in Setup first.'}</p>
      ${can('linenManage') ? '<button onclick="lnGo(\'setup\')">Open setup</button>' : ''}</div>`;
    return;
  }
  const t = lnTotals();
  const loop = t.clean + t.in_use + t.soiled + t.washing + t.missing;
  const pct = (n) => (loop ? (n / loop * 100) : 0).toFixed(2);
  const missingCost = d.pieces.filter((p) => p.status === 'missing').reduce((a, p) => a + (p.cost || lnType(p.typeId).cost || 0), 0);
  const due = lnPlaces().filter(lnPlaceDue).length;
  const q = [];
  if (can('linenUse')) q.push(['lnGo(\'rooms\')', 'Change a bed or towels', 'Pick the room, scan on and off']);
  if (can('linenWash')) q.push(['lnOpenSend()', 'Send to wash', `${t.soiled} in the soiled bin`]);
  if (can('linenWash')) q.push(['lnReceiveNext()', 'Receive from wash', `${d.batches.filter((b) => b.status === 'washing').length} batch(es) washing`]);
  if (can('linenUse')) q.push(['lnGo(\'stock\')', 'Count or restock', 'Storeroom and cupboards']);
  if (can('linenUse') || can('linenWash')) q.push(['lnOpenDamage()', 'Report damage', 'Torn, stained, burnt, worn']);
  q.push(['lnOpenLookup()', 'Look up a piece', 'Scan any label']);
  const alerts = lnAlerts();
  const typeRows = lnTypesInUse();
  const need = lnNeedPerType();
  v.innerHTML = `
    <div class="ln-head"><div><h2>Bed linen & towels</h2><p class="hint">Where every piece is right now.</p></div></div>
    <div class="ln-quick">${q.map(([a, t1, s]) => `<button class="ln-qbtn" onclick="${a}"><b>${t1}</b><span>${esc(s)}</span></button>`).join('')}</div>
    <div class="stats">
      <div class="stat"><div class="k">Clean</div><div class="v">${t.clean}</div><div class="muted" style="font-size:12px">storeroom & cupboards</div></div>
      <div class="stat"><div class="k">In use</div><div class="v">${t.in_use}</div><div class="muted" style="font-size:12px">on beds & in bathrooms</div></div>
      <div class="stat"><div class="k">In laundry</div><div class="v">${t.soiled + t.washing}</div><div class="muted" style="font-size:12px">${t.soiled} soiled · ${t.washing} washing</div></div>
      <div class="stat"><div class="k">Due a change</div><div class="v">${due}</div><div class="muted" style="font-size:12px">beds & towels</div></div>
      <div class="stat"><div class="k">Missing</div><div class="v" style="color:${t.missing ? 'var(--danger)' : 'inherit'}">${t.missing}</div><div class="muted" style="font-size:12px">${money(missingCost)} to replace</div></div>
    </div>
    <div class="card">
      <h3 style="margin:0 0 8px">Where your ${loop} pieces are</h3>
      <div class="ln-flow">
        <div class="ln-c-clean" style="width:${pct(t.clean)}%" title="Clean">${t.clean}</div>
        <div class="ln-c-use" style="width:${pct(t.in_use)}%" title="In use">${t.in_use}</div>
        <div class="ln-c-soiled" style="width:${pct(t.soiled)}%" title="Soiled">${t.soiled}</div>
        <div class="ln-c-wash" style="width:${pct(t.washing)}%" title="In the wash">${t.washing}</div>
        <div class="ln-c-miss" style="width:${pct(t.missing)}%" title="Missing">${t.missing}</div>
      </div>
      <div class="ln-legend"><span><i class="ln-c-clean"></i>Clean</span><span><i class="ln-c-use"></i>In use</span><span><i class="ln-c-soiled"></i>Soiled bin</span><span><i class="ln-c-wash"></i>In the wash</span><span><i class="ln-c-miss"></i>Missing</span></div>
    </div>
    <div class="card"><h3 style="margin:0 0 10px">Needs attention</h3>
      ${alerts.length ? `<div class="ln-alerts">${alerts.map((a) => `<div class="ln-alert ln-al-${a.level}"><div><b>${esc(a.title)}</b><p>${esc(a.text)}</p></div>${a.action ? `<button class="small secondary" onclick="${a.action}">${a.label}</button>` : '<span></span>'}</div>`).join('')}</div>` : '<p class="muted" style="margin:0">All clear.</p>'}
    </div>
    <div class="card"><h3 style="margin:0 0 4px">Stock against target</h3>
      <p class="hint">Target is ${d.par} sets for every bed and bathroom: one in use, one in the wash, one on the shelf.</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>Item</th><th class="ln-n">Clean</th><th class="ln-n">In use</th><th class="ln-n">Laundry</th><th class="ln-n">Missing</th><th class="ln-n">Owned</th><th class="ln-n">Target</th><th>Cover</th></tr></thead><tbody>
      ${typeRows.map((ty) => {
        const ps = d.pieces.filter((p) => p.typeId === ty.id);
        const c = (s) => ps.filter((p) => p.status === s).length;
        const owned = ps.filter(lnActive).length, target = (need[ty.id] || 0) * d.par;
        const r = target ? owned / target : 1;
        const [lbl, cls, col] = !target ? ['Not used', 'ln-mute', 'var(--muted)'] : r >= 0.95 ? ['On target', 'ln-ok', 'var(--ok)'] : r >= 0.75 ? ['Low', 'ln-amber', 'var(--warn)'] : ['Short', 'ln-bad', 'var(--danger)'];
        return `<tr><td>${esc(ty.name)}</td><td class="ln-n">${c('clean')}</td><td class="ln-n">${c('in_use')}</td><td class="ln-n">${c('soiled') + c('washing')}</td><td class="ln-n">${c('missing') || '<span class="muted">0</span>'}</td><td class="ln-n"><b>${owned}</b></td><td class="ln-n muted">${target}</td>
          <td><div class="ln-cover"><div class="ln-bar"><i style="width:${Math.min(100, r * 100)}%;background:${col}"></i></div><span class="ln-tag ${cls}">${lbl}</span></div></td></tr>`;
      }).join('')}
      </tbody></table></div></div>`;
}
function lnAlerts() {
  const d = LN.doc, a = [];
  const places = lnPlaces();
  const clean = lnCountBy((p) => p.status === 'clean');
  const maxPer = {};
  places.forEach((pl) => Object.entries(pl.set).forEach(([k, n]) => { maxPer[k] = Math.max(maxPer[k] || 0, n); }));
  Object.entries(maxPer).forEach(([k, n]) => {
    if ((clean[k] || 0) < n) a.push({ level: 'bad', title: `No clean ${lnTypeName(k).toLowerCase()}s left`, text: `${clean[k] || 0} clean. The next bed or bathroom that needs one can't be done until the wash comes back.`, action: can('linenWash') ? "lnGo('wash')" : '', label: 'Open wash' });
  });
  const missing = d.pieces.filter((p) => p.status === 'missing');
  if (missing.length) a.push({ level: 'bad', title: `${missing.length} piece(s) missing`, text: [...new Set(missing.map((p) => p.missingFrom))].slice(0, 3).join(' · '), action: can('linenManage') ? "lnGo('review')" : 'lnShowMissing()', label: can('linenManage') ? 'Check them' : 'See missing' });
  const dmgToCheck = d.pieces.filter((p) => p.status === 'retired' && p.checked === false);
  if (dmgToCheck.length && can('linenManage')) a.push({ level: 'warn', title: `${dmgToCheck.length} damaged piece(s) to check`, text: 'Reported by staff. Confirm, or put back in use.', action: "lnGo('review')", label: 'Check them' });
  d.batches.filter((b) => b.status === 'washing' && lnHours(b.sentAt) >= d.washAlertHours).forEach((b) =>
    a.push({ level: 'warn', title: `${b.number} has been in the wash ${Math.floor(lnHours(b.sentAt))} hours`, text: `${b.codes.length} pieces sent ${fmt(b.sentAt)} by ${b.sentBy}.`, action: can('linenWash') ? `lnOpenReceive('${b.id}')` : '', label: 'Receive' }));
  const checkouts = d.rooms.filter((r) => r.checkoutAt);
  if (checkouts.length) a.push({ level: 'warn', title: `Checked out: ${checkouts.map((r) => r.name).join(', ')}`, text: 'Change the beds and towels in these rooms.', action: "lnRoomsFilter('checkout')", label: 'Open rooms' });
  const stripped = places.filter((pl) => pl.state !== 'made');
  if (stripped.length) a.push({ level: 'warn', title: `${stripped.length} bed(s)/bathroom(s) not made up`, text: stripped.slice(0, 6).map((pl) => `${pl.room.name} ${pl.label}`).join(', ') + (stripped.length > 6 ? '…' : ''), action: "lnRoomsFilter('due')", label: 'Open rooms' });
  const old = places.filter((pl) => lnPlaceDue(pl) === 'old');
  if (old.length) a.push({ level: 'info', title: `${old.length} due a routine change`, text: `Beds after ${d.bedChangeDays} day(s), towels after ${d.towelChangeDays} day(s).`, action: "lnRoomsFilter('due')", label: 'Open rooms' });
  const need = lnNeedPerType();
  const short = lnTypesInUse().filter((ty) => need[ty.id] && d.pieces.filter((p) => p.typeId === ty.id && lnActive(p)).length < need[ty.id] * d.par * 0.95);
  if (short.length && can('linenManage')) a.push({ level: 'info', title: 'Below target: time to reorder', text: short.map((ty) => ty.name).join(', '), action: "lnGo('reports')", label: 'Reorder list' });
  const worn = d.pieces.filter((p) => lnActive(p) && p.washes >= lnType(p.typeId).washLife * 0.9);
  if (worn.length && can('linenManage')) a.push({ level: 'info', title: `${worn.length} piece(s) near the end of their life`, text: 'Check them next time they come out of the wash.', action: "lnGo('reports')", label: 'See list' });
  return a;
}
window.lnRoomsFilter = (f) => { LN.roomFilter = f; lnGo('rooms'); };
window.lnShowMissing = () => { LN.pieceFilter = { status: 'missing', type: '', loc: '', q: '' }; lnGo('pieces'); };

// ------------------------------------------------------------------ rooms ---
function lnRooms(v) {
  const d = LN.doc, f = LN.roomFilter;
  if (!d.rooms.length) { v.innerHTML = '<div class="card"><p class="muted" style="margin:0">No rooms yet. An admin adds them in Setup.</p></div>'; return; }
  const places = lnPlaces();
  const clean = (room) => d.pieces.filter((p) => p.status === 'clean' && p.loc === room).length;
  v.innerHTML = `
    <div class="ln-head"><div><h2>Rooms</h2><p class="hint">${can('linenUse') ? 'Tap a bed or towels to change them.' : 'Mark a room checked out and housekeeping sees it straight away.'}</p></div>
      <div class="ln-filters">${[['all', 'All'], ['due', 'Due a change'], ['checkout', 'Checked out']].map(([k, l]) => `<button class="small ${f === k ? '' : 'secondary'}" onclick="lnRoomsFilter('${k}')">${l}</button>`).join('')}</div></div>
    <div class="ln-rooms">${d.rooms.map((r, ri) => {
      let pls = places.filter((pl) => pl.ri === ri);
      if (f === 'due') pls = pls.filter(lnPlaceDue);
      if (f === 'checkout' && !r.checkoutAt) return '';
      if (!pls.length && f !== 'all') return '';
      return `<div class="ln-room">
        <div class="ln-room-h"><b>${esc(r.name)}</b>${r.checkoutAt ? `<span class="ln-tag ln-amber">Checked out ${fmt(r.checkoutAt)}</span>` : ''}</div>
        <div class="muted" style="font-size:12px;margin:2px 0 8px">${r.beds.length} bed(s)${r.cupboard ? ` · cupboard: ${clean(r.name)} clean` : ''}</div>
        <div class="ln-places">${pls.map((pl) => {
          const due = lnPlaceDue(pl);
          const cls = due === 'stripped' ? 'ln-pl-bad' : due ? 'ln-pl-due' : '';
          const st = due === 'stripped' ? 'Not made up' : due === 'checkout' ? 'Checkout: change' : pl.changedAt ? (lnDays(pl.changedAt) === 0 ? 'Changed today' : `${lnDays(pl.changedAt)} day(s) ago`) : 'Made';
          return `<button class="ln-place ${cls}" onclick="lnOpenChange(${pl.ri},${pl.bi})" ${can('linenUse') ? '' : 'disabled'}><b>${esc(pl.label)}</b><span>${pl.kind === 'bed' ? esc(pl.size) + ' · ' : ''}${st}</span></button>`;
        }).join('')}</div>
        ${can('linenCheckout') && !r.checkoutAt ? `<button class="small secondary" style="margin-top:10px" onclick="lnCheckout(${ri})">Mark checked out</button>` : ''}
      </div>`;
    }).join('') || '<p class="muted">Nothing here.</p>'}</div>
    <div class="ln-legend"><span><i style="background:#fdf1e1;border:1px solid var(--warn)"></i>Due: checkout or ${d.bedChangeDays}+ days (towels ${d.towelChangeDays}+)</span><span><i style="background:#fdeaea;border:1px solid var(--danger)"></i>Not made up</span></div>`;
}
window.lnCheckout = async (ri) => {
  const r = LN.doc.rooms[ri];
  if (!confirm(`Mark ${r.name} as checked out? Housekeeping will see its beds and towels as due a change.`)) return;
  try { await api('POST', '/linen/checkout', { room: r.name }); await lnReload(); } catch (e) { alert(e.message); }
};

// Change a bed (bi ≥ 0) or a room's towels (bi = -1).
window.lnOpenChange = (ri, bi) => {
  if (!can('linenUse')) return;
  const r = LN.doc.rooms[ri];
  const bed = bi >= 0 ? r.beds[bi] : null;
  const set = bed ? (LN.doc.bedSets[bed.size] || {}) : r.towels;
  const current = LN.doc.pieces.filter((p) => p.status === 'in_use' && p.room === r.name && (p.bed || null) === (bed ? bed.id : null));
  LN.chg = { room: r.name, bed: bed ? bed.id : null, title: `${r.name} · ${bed ? bed.label + ' · ' + bed.size : 'Towels'}`, set, current: current.map((p) => ({ code: p.code, typeId: p.typeId, mode: 'off' })), on: [] };
  lnDrawChange();
};
function lnDrawChange() {
  const c = LN.chg;
  const onBy = {};
  c.on.forEach((code) => { const t = lnPiece(code).typeId; onBy[t] = (onBy[t] || 0) + 1; });
  const keepBy = {};
  c.current.filter((x) => x.mode === 'keep').forEach((x) => { keepBy[x.typeId] = (keepBy[x.typeId] || 0) + 1; });
  const short = Object.entries(c.set).filter(([k, n]) => (onBy[k] || 0) + (keepBy[k] || 0) < n).map(([k, n]) => `${n - (onBy[k] || 0) - (keepBy[k] || 0)} × ${lnTypeName(k).toLowerCase()}`);
  openModal(`
    <button class="ghost small close" onclick="closeModal()">✕</button>
    <h3>${esc(c.title)}</h3>
    <div id="chgMsg"></div>
    <div class="ln-sec">1 · Coming off</div>
    ${c.current.length ? `<p class="hint" style="margin:0 0 8px">Everything recorded here. Scan pieces as you strip them, or just leave them on <b>Off</b>. Anything not there: tap <b>Missing</b>.</p>
      <div class="ln-list">${c.current.map((x, i) => `<div class="ln-li"><div><b class="ln-code">${x.code}</b> <span class="muted">${esc(lnTypeName(x.typeId))}</span></div>
        <div class="ln-seg">${[['off', 'Off'], ['keep', 'Stays'], ['missing', 'Missing']].map(([m, l]) => `<button class="${x.mode === m ? 'on ln-seg-' + m : ''}" onclick="lnChgMode(${i},'${m}')">${l}</button>`).join('')}</div></div>`).join('')}</div>`
      : '<p class="hint" style="margin:0">Nothing recorded on it.</p>'}
    <div class="ln-sec">2 · Going on</div>
    <p class="hint" style="margin:0 0 8px">Needs ${Object.entries(c.set).map(([k, n]) => `${n} × ${esc(lnTypeName(k).toLowerCase())}`).join(', ') || 'nothing (no set up)'}. Scan each clean piece you put on.</p>
    ${lnScanField('chgScan')}
    <div class="ln-chips">${c.on.map((code, i) => `<span class="ln-chip"><b>${code}</b> ${esc(lnTypeName(lnPiece(code).typeId))} <button onclick="lnChgDrop(${i})" aria-label="Remove">✕</button></span>`).join('')}</div>
    ${short.length ? `<p class="ln-short">Still needs ${short.join(', ')}. <button class="ghost small" onclick="lnChgPick()">Pick for me</button></p>` : (c.on.length ? '<p class="ln-ok-text" style="margin:8px 0 0">Full set ✓</p>' : '')}
    <div class="ln-foot">
      <button class="secondary" onclick="lnChgSubmit(true)" ${c.current.length ? '' : 'disabled'}>Strip only, make later</button>
      <button onclick="lnChgSubmit(false)">Done</button>
    </div>`);
  lnBindScan('chgScan', (code) => {
    const cur = c.current.find((x) => x.code === code);
    if (cur) { cur.mode = 'off'; lnDrawChange(); return { ok: `${code} coming off` }; }
    const p = lnPiece(code);
    if (!p) return { err: `${code} isn't a known piece.` };
    if (c.on.includes(code)) return { err: `${code} is already scanned.` };
    if (!['clean', 'missing'].includes(p.status)) return { err: `${code} is ${LN_STATUS[p.status][0].toLowerCase()} (${lnWhere(p)}). Only clean linen goes on.` };
    c.on.push(code); lnDrawChange();
    return { ok: `${code} ${lnTypeName(p.typeId)}${c.set[p.typeId] ? '' : ' (not in this set)'}` };
  });
}
window.lnChgMode = (i, m) => { LN.chg.current[i].mode = m; lnDrawChange(); };
window.lnChgDrop = (i) => { LN.chg.on.splice(i, 1); lnDrawChange(); };
// Fill what's still needed from clean stock: this room's cupboard first, then
// the storeroom, least-washed first so wear is spread evenly.
window.lnChgPick = () => {
  const c = LN.chg;
  const have = {};
  c.on.forEach((code) => { const t = lnPiece(code).typeId; have[t] = (have[t] || 0) + 1; });
  c.current.filter((x) => x.mode === 'keep').forEach((x) => { have[x.typeId] = (have[x.typeId] || 0) + 1; });
  const rank = (p) => (p.loc === c.room ? 0 : p.loc === 'store' ? 1 : 2);
  const missingTypes = [];
  Object.entries(c.set).forEach(([k, n]) => {
    const want = n - (have[k] || 0);
    if (want <= 0) return;
    const pool = LN.doc.pieces.filter((p) => p.typeId === k && p.status === 'clean' && !c.on.includes(p.code)).sort((a, b) => rank(a) - rank(b) || a.washes - b.washes || a.code.localeCompare(b.code));
    pool.slice(0, want).forEach((p) => c.on.push(p.code));
    if (pool.length < want) missingTypes.push(lnTypeName(k).toLowerCase());
  });
  lnDrawChange();
  const where = [...new Set(c.on.map((code) => lnLocName(lnPiece(code).loc)))].join(', ');
  notice($('#chgMsg'), missingTypes.length ? 'err' : 'info', missingTypes.length
    ? `Not enough clean ${missingTypes.join(', ')}.`
    : `Take exactly these pieces from ${where}. Check each code as you take it.`);
};
window.lnChgSubmit = async (stripOnly) => {
  const c = LN.chg;
  const body = {
    room: c.room, bed: c.bed,
    off: c.current.filter((x) => x.mode === 'off').map((x) => x.code),
    keep: c.current.filter((x) => x.mode === 'keep').map((x) => x.code),
    on: stripOnly ? [] : c.on,
  };
  const miss = c.current.filter((x) => x.mode === 'missing').length;
  if (miss && !confirm(`${miss} piece(s) will be recorded as missing from ${c.title}. Continue?`)) return;
  if (!stripOnly && !c.on.length && !body.keep.length) return notice($('#chgMsg'), 'err', 'Scan the pieces going on, or tap "Strip only, make later".');
  try { await api('POST', '/linen/change', body); closeModal(); await lnReload(); } catch (e) { notice($('#chgMsg'), 'err', e.message); }
};

// ------------------------------------------------------------------- wash ---
function lnWash(v) {
  const d = LN.doc;
  const soiled = lnCountBy((p) => p.status === 'soiled');
  const total = Object.values(soiled).reduce((a, b) => a + b, 0);
  const batches = d.batches.slice().reverse().slice(0, 60);
  const outstanding = (b) => (b.missing || []).filter((c) => { const p = lnPiece(c); return p && p.status === 'missing'; }).length;
  v.innerHTML = `
    <div class="ln-head"><div><h2>Wash</h2><p class="hint">Out by piece, back by piece. Anything that doesn't come back is flagged missing.</p></div>
      ${can('linenWash') ? `<button onclick="lnOpenSend()" ${total ? '' : 'disabled'}>Send soiled linen to wash</button>` : ''}</div>
    <div class="card"><h3 style="margin:0 0 6px">Soiled bin · ${total} piece(s)</h3>
      <p class="muted" style="margin:0">${Object.entries(soiled).map(([k, n]) => `${n} × ${esc(lnTypeName(k).toLowerCase())}`).join(' · ') || 'Empty.'}</p></div>
    <div class="card"><div class="table-wrap"><table class="data"><thead><tr><th>Batch</th><th>Sent</th><th class="ln-n">Out</th><th class="ln-n">Back</th><th>Status</th><th></th></tr></thead><tbody>
    ${batches.map((b) => {
      const late = b.status === 'washing' && lnHours(b.sentAt) >= d.washAlertHours;
      const out = outstanding(b);
      const tag = b.status === 'washing' ? `<span class="ln-tag ${late ? 'ln-bad' : 'ln-violet'}">Washing${late ? ' · ' + Math.floor(lnHours(b.sentAt)) + 'h' : ''}</span>`
        : b.status === 'short' ? (out ? `<span class="ln-tag ln-bad">${out} missing</span>` : '<span class="ln-tag ln-mute">Short · settled</span>')
        : '<span class="ln-tag ln-ok">All back</span>';
      const act = b.status === 'washing' && can('linenWash') ? `<button class="small" onclick="lnOpenReceive('${b.id}')">Receive</button>` : (out ? `<button class="small secondary" onclick="lnShowMissing()">See missing</button>` : '');
      return `<tr><td><b>${b.number}</b></td><td>${fmt(b.sentAt)}<div class="muted" style="font-size:12px">${esc(b.sentBy)}${b.receivedAt ? ` · back ${fmt(b.receivedAt)} (${esc(b.receivedBy)})` : ''}</div></td>
        <td class="ln-n">${b.codes.length}</td><td class="ln-n">${b.receivedAt ? (b.back.length + b.rewash.length + b.damaged.length) : '—'}</td><td>${tag}</td><td>${act}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="muted">No batches yet.</td></tr>'}
    </tbody></table></div></div>`;
}
window.lnOpenSend = () => {
  const soiled = LN.doc.pieces.filter((p) => p.status === 'soiled').sort((a, b) => a.typeId.localeCompare(b.typeId) || a.code.localeCompare(b.code));
  if (!soiled.length) return alert('The soiled bin is empty.');
  LN.send = { pieces: soiled, pick: new Set(soiled.map((p) => p.code)) };
  lnDrawSend();
};
function lnDrawSend() {
  const s = LN.send;
  const groups = {};
  s.pieces.forEach((p) => { (groups[p.typeId] = groups[p.typeId] || []).push(p); });
  openModal(`
    <button class="ghost small close" onclick="closeModal()">✕</button>
    <h3>Send to wash</h3><div id="sendMsg"></div>
    <p class="hint" style="margin:0 0 8px">Everything in the soiled bin is ticked. Untick anything you're not sending now.</p>
    <div class="ln-list" style="max-height:340px;overflow:auto">${Object.entries(groups).map(([k, ps]) => `
      <div class="ln-grp"><b>${esc(lnTypeName(k))}</b> <span class="muted">${ps.filter((p) => s.pick.has(p.code)).length} of ${ps.length}</span></div>
      <div class="ln-codes">${ps.map((p) => `<label class="ln-cb"><input type="checkbox" ${s.pick.has(p.code) ? 'checked' : ''} onchange="lnSendTick('${p.code}',this.checked)"> ${p.code}</label>`).join('')}</div>`).join('')}</div>
    <div class="ln-foot"><span class="muted">${s.pick.size} piece(s)</span><button onclick="lnSendSubmit()" ${s.pick.size ? '' : 'disabled'}>Send batch</button></div>`);
}
window.lnSendTick = (code, on) => { if (on) LN.send.pick.add(code); else LN.send.pick.delete(code); lnDrawSend(); };
window.lnSendSubmit = async () => {
  try { const b = await api('POST', '/linen/wash', { codes: [...LN.send.pick] }); closeModal(); await lnReload(); alert(`${b.number} sent · ${b.codes.length} pieces.`); }
  catch (e) { notice($('#sendMsg'), 'err', e.message); }
};
window.lnReceiveNext = () => {
  const b = LN.doc.batches.find((x) => x.status === 'washing');
  if (!b) return alert('No batch is in the wash.');
  lnOpenReceive(b.id);
};
window.lnOpenReceive = (id) => {
  const b = LN.doc.batches.find((x) => x.id === id);
  LN.rcv = { batch: b, mark: {}, loc: 'store', note: '' };
  lnDrawReceive();
};
function lnDrawReceive() {
  const r = LN.rcv, b = r.batch;
  const counts = { back: 0, rewash: 0, damaged: 0 };
  Object.values(r.mark).forEach((m) => { counts[m] += 1; });
  const left = b.codes.length - counts.back - counts.rewash - counts.damaged;
  const groups = {};
  b.codes.forEach((c) => { const p = lnPiece(c); const t = p ? p.typeId : '?'; (groups[t] = groups[t] || []).push(c); });
  openModal(`
    <button class="ghost small close" onclick="closeModal()">✕</button>
    <h3>Receive ${b.number}</h3><div id="rcvMsg"></div>
    <p class="hint" style="margin:0 0 8px">Sent ${fmt(b.sentAt)} by ${esc(b.sentBy)}. Scan every piece as you fold it. Anything not scanned is marked missing.</p>
    ${lnScanField('rcvScan')}
    <div class="ln-sum"><span class="ln-tag ln-ok">${counts.back} back</span> <span class="ln-tag ln-amber">${counts.rewash} re-wash</span> <span class="ln-tag ln-mute">${counts.damaged} damaged</span> <span class="ln-tag ${left ? 'ln-bad' : 'ln-ok'}">${left} not scanned</span></div>
    <div class="ln-list" style="max-height:300px;overflow:auto">${Object.entries(groups).map(([k, cs]) => `
      <div class="ln-grp"><b>${esc(lnTypeName(k))}</b> <span class="muted">${cs.filter((c) => r.mark[c]).length} of ${cs.length}</span></div>
      ${cs.map((c) => `<div class="ln-li"><b class="ln-code">${c}</b><div class="ln-seg">${[['back', 'Back'], ['rewash', 'Re-wash'], ['damaged', 'Damaged']].map(([m, l]) => `<button class="${r.mark[c] === m ? 'on ln-seg-' + m : ''}" onclick="lnRcvMark('${c}','${m}')">${l}</button>`).join('')}</div></div>`).join('')}`).join('')}</div>
    ${left ? `<button class="ghost small" onclick="lnRcvAll()">Mark the ${left} not scanned as back clean</button>` : ''}
    <div class="row" style="margin-top:6px"><div><label>Clean pieces go to</label><select id="rcvLoc" onchange="LN.rcv.loc=this.value">${lnLocOptions(r.loc)}</select></div>
      ${counts.damaged ? `<div><label>What's wrong with the damaged</label><input id="rcvNote" value="${esc(r.note)}" oninput="LN.rcv.note=this.value" placeholder="e.g. torn hem, permanent stain"></div>` : ''}</div>
    <div class="ln-foot"><button onclick="lnRcvSubmit()">Confirm received${left ? ` · ${left} missing` : ''}</button></div>`);
  lnBindScan('rcvScan', (code) => {
    if (!b.codes.includes(code)) {
      const p = lnPiece(code);
      return { err: p ? `${code} wasn't sent in ${b.number} (${LN_STATUS[p.status][0].toLowerCase()}: ${lnWhere(p)}).` : `${code} isn't a known piece.` };
    }
    if (r.mark[code] === 'back') return { err: `${code} is already scanned.` };
    r.mark[code] = 'back'; lnDrawReceive();
    return { ok: `${code} back clean` };
  });
}
window.lnRcvMark = (c, m) => { if (LN.rcv.mark[c] === m) delete LN.rcv.mark[c]; else LN.rcv.mark[c] = m; lnDrawReceive(); };
window.lnRcvAll = () => {
  if (!confirm('Mark every piece you haven\'t scanned as back clean? Only do this if you have counted them.')) return;
  LN.rcv.batch.codes.forEach((c) => { if (!LN.rcv.mark[c]) LN.rcv.mark[c] = 'back'; });
  lnDrawReceive();
};
window.lnRcvSubmit = async () => {
  const r = LN.rcv;
  const pick = (m) => Object.keys(r.mark).filter((c) => r.mark[c] === m);
  const left = r.batch.codes.length - Object.keys(r.mark).length;
  if (left && !confirm(`${left} piece(s) weren't scanned and will be marked missing. Continue?`)) return;
  try {
    await api('POST', `/linen/batches/${r.batch.id}/receive`, { back: pick('back'), rewash: pick('rewash'), damaged: pick('damaged'), loc: r.loc, note: r.note });
    closeModal(); await lnReload();
  } catch (e) { notice($('#rcvMsg'), 'err', e.message); }
};

// ------------------------------------------------- storeroom & cupboards ---
function lnStock(v) {
  const d = LN.doc;
  const locs = [['store', 'Storeroom'], ...lnCupboards().map((r) => [r.name, `${r.name} cupboard`])];
  if (!locs.find(([l]) => l === LN.loc)) LN.loc = 'store';
  const here = d.pieces.filter((p) => p.status === 'clean' && p.loc === LN.loc);
  const by = {};
  here.forEach((p) => { by[p.typeId] = (by[p.typeId] || 0) + 1; });
  // A cupboard should hold one full change for its room.
  const room = d.rooms.find((r) => r.name === LN.loc);
  const want = {};
  if (room) {
    room.beds.forEach((b) => Object.entries(d.bedSets[b.size] || {}).forEach(([k, n]) => { want[k] = (want[k] || 0) + n; }));
    Object.entries(room.towels || {}).forEach(([k, n]) => { want[k] = (want[k] || 0) + n; });
  }
  const types = [...new Set([...Object.keys(by), ...Object.keys(want)])];
  const lastCount = d.log.slice().reverse().find((l) => l.action === `Counted ${LN.loc === 'store' ? 'the storeroom' : 'the ' + LN.loc + ' cupboard'}`);
  v.innerHTML = `
    <div class="ln-head"><div><h2>Storeroom & cupboards</h2><p class="hint">Clean linen, wherever it's kept. ${lnCupboards().length ? '' : 'Tick "Has a cupboard" on a room in Setup to keep linen in the room.'}</p></div></div>
    <div class="ln-filters" style="margin-bottom:12px">${locs.map(([l, name], i) => `<button class="small ${l === LN.loc ? '' : 'secondary'}" onclick="lnSetLoc(${i})">${esc(name)} · ${d.pieces.filter((p) => p.status === 'clean' && p.loc === l).length}</button>`).join('')}</div>
    <div class="card">
      <div class="ln-head" style="margin-bottom:8px"><div><h3 style="margin:0">${esc(lnLocName(LN.loc))} · ${here.length} clean</h3><p class="hint" style="margin:2px 0 0">${lastCount ? `Last counted ${fmt(lastCount.at)} by ${esc(lastCount.by)}` : 'Not counted yet.'}</p></div>
        ${can('linenUse') ? `<div class="ln-filters"><button class="small secondary" onclick="lnOpenMove()">${room ? 'Restock this cupboard' : 'Move linen here'}</button><button class="small" onclick="lnOpenCount()">Count it</button></div>` : ''}</div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Item</th><th class="ln-n">Here</th>${room ? '<th class="ln-n">One change</th><th></th>' : ''}</tr></thead><tbody>
      ${types.map((k) => `<tr><td>${esc(lnTypeName(k))}</td><td class="ln-n"><b>${by[k] || 0}</b></td>${room ? `<td class="ln-n muted">${want[k] || 0}</td><td>${(by[k] || 0) < (want[k] || 0) ? `<span class="ln-tag ln-amber">${(want[k] || 0) - (by[k] || 0)} short</span>` : '<span class="ln-tag ln-ok">Ready</span>'}</td>` : ''}</tr>`).join('') || `<tr><td colspan="4" class="muted">Empty.</td></tr>`}
      </tbody></table></div></div>`;
}
window.lnSetLoc = (i) => { LN.loc = i === 0 ? 'store' : lnCupboards()[i - 1].name; lnGo('stock'); };
window.lnOpenCount = () => {
  LN.cnt = { loc: LN.loc, seen: [] };
  lnDrawCount();
};
function lnDrawCount() {
  const c = LN.cnt;
  const expected = LN.doc.pieces.filter((p) => p.status === 'clean' && p.loc === c.loc);
  const exp = new Set(expected.map((p) => p.code));
  const types = [...new Set([...expected.map((p) => p.typeId), ...c.seen.map((x) => lnPiece(x).typeId)])];
  const extras = c.seen.filter((x) => !exp.has(x));
  const notYet = expected.filter((p) => !c.seen.includes(p.code)).length;
  openModal(`
    <button class="ghost small close" onclick="closeModal()">✕</button>
    <h3>Count ${esc(lnLocName(c.loc))}</h3><div id="cntMsg"></div>
    <p class="hint" style="margin:0 0 8px">Scan every clean piece that's actually here. When you save, anything not scanned is marked missing, and anything scanned is recorded here.</p>
    ${lnScanField('cntScan')}
    <div class="table-wrap"><table class="data" style="min-width:0"><thead><tr><th>Item</th><th class="ln-n">Expected</th><th class="ln-n">Scanned</th><th></th></tr></thead><tbody>
    ${types.map((k) => {
      const e = expected.filter((p) => p.typeId === k).length, s = c.seen.filter((x) => lnPiece(x).typeId === k).length;
      return `<tr><td>${esc(lnTypeName(k))}</td><td class="ln-n">${e}</td><td class="ln-n"><b>${s}</b></td><td>${s === e ? '<span class="ln-tag ln-ok">✓</span>' : `<span class="ln-tag ${s < e ? 'ln-amber' : 'ln-blue'}">${s > e ? '+' : ''}${s - e}</span>`}</td></tr>`;
    }).join('') || '<tr><td colspan="4" class="muted">Nothing expected here. Scan what you find.</td></tr>'}
    </tbody></table></div>
    ${extras.length ? `<p class="hint">Not recorded here: ${extras.map((x) => { const p = lnPiece(x); return `<b>${x}</b> (${LN_STATUS[p.status][0].toLowerCase()})`; }).join(', ')}. Saving puts them here.</p>` : ''}
    <label>Note ${notYet ? '<span class="muted">(needed: say where you looked)</span>' : '<span class="muted">(optional)</span>'}</label>
    <textarea id="cntNote" rows="2" placeholder="e.g. checked every shelf and the trolley">${esc(c.note || '')}</textarea>
    <div class="ln-foot"><span class="muted">${c.seen.length} scanned${notYet ? ` · ${notYet} not yet` : ''}</span><button onclick="lnCountSubmit()">Save count</button></div>`);
  $('#cntNote').oninput = (e) => { c.note = e.target.value; };
  lnBindScan('cntScan', (code) => {
    const p = lnPiece(code);
    if (!p) return { err: `${code} isn't a known piece.` };
    if (c.seen.includes(code)) return { err: `${code} already counted.` };
    if (p.status === 'retired') return { err: `${code} was taken out of stock (${LN_REASONS[p.retiredReason] || ''}). Put it aside for the manager.` };
    c.seen.push(code); lnDrawCount();
    return { ok: `${code} ${lnTypeName(p.typeId)}${exp.has(code) ? '' : ' · not recorded here'}` };
  });
}
window.lnCountSubmit = async () => {
  const c = LN.cnt;
  try {
    const r = await api('POST', '/linen/count', { loc: c.loc, codes: c.seen, note: c.note || '' });
    closeModal(); await lnReload();
    alert(`Count saved. ${r.counted} counted${r.moved ? `, ${r.moved} moved here` : ''}${r.found ? `, ${r.found} found` : ''}${r.missing.length ? `, ${r.missing.length} marked missing` : ''}.`);
  } catch (e) { notice($('#cntMsg'), 'err', e.message); }
};
window.lnOpenMove = () => {
  LN.mv = { to: LN.loc, codes: [] };
  lnDrawMove();
};
function lnDrawMove() {
  const m = LN.mv;
  const room = LN.doc.rooms.find((r) => r.name === m.to);
  openModal(`
    <button class="ghost small close" onclick="closeModal()">✕</button>
    <h3>Move clean linen to ${esc(lnLocName(m.to))}</h3><div id="mvMsg"></div>
    <p class="hint" style="margin:0 0 8px">Scan each piece as you put it ${room ? 'in the cupboard' : 'on the shelf'}.</p>
    ${lnScanField('mvScan')}
    <div class="ln-chips">${m.codes.map((c, i) => `<span class="ln-chip"><b>${c}</b> ${esc(lnTypeName(lnPiece(c).typeId))} <button onclick="LN.mv.codes.splice(${i},1);lnDrawMove()" aria-label="Remove">✕</button></span>`).join('')}</div>
    ${room ? '<button class="ghost small" onclick="lnMovePick()">Pick one change for this room from the storeroom</button>' : ''}
    <div class="ln-foot"><span class="muted">${m.codes.length} piece(s)</span><button onclick="lnMoveSubmit()" ${m.codes.length ? '' : 'disabled'}>Move</button></div>`);
  lnBindScan('mvScan', (code) => {
    const p = lnPiece(code);
    if (!p) return { err: `${code} isn't a known piece.` };
    if (p.status !== 'clean') return { err: `${code} is ${LN_STATUS[p.status][0].toLowerCase()}. Only clean linen can be moved.` };
    if (p.loc === m.to) return { err: `${code} is already here.` };
    if (m.codes.includes(code)) return { err: `${code} already scanned.` };
    m.codes.push(code); lnDrawMove();
    return { ok: `${code} ${lnTypeName(p.typeId)}` };
  });
}
window.lnMovePick = () => {
  const m = LN.mv, d = LN.doc;
  const room = d.rooms.find((r) => r.name === m.to);
  const want = {};
  room.beds.forEach((b) => Object.entries(d.bedSets[b.size] || {}).forEach(([k, n]) => { want[k] = (want[k] || 0) + n; }));
  Object.entries(room.towels || {}).forEach(([k, n]) => { want[k] = (want[k] || 0) + n; });
  const have = lnCountBy((p) => p.status === 'clean' && p.loc === m.to);
  m.codes.forEach((c) => { const t = lnPiece(c).typeId; have[t] = (have[t] || 0) + 1; });
  Object.entries(want).forEach(([k, n]) => {
    const need = n - (have[k] || 0);
    if (need > 0) d.pieces.filter((p) => p.typeId === k && p.status === 'clean' && p.loc === 'store' && !m.codes.includes(p.code))
      .sort((a, b) => a.washes - b.washes || a.code.localeCompare(b.code)).slice(0, need).forEach((p) => m.codes.push(p.code));
  });
  lnDrawMove();
  notice($('#mvMsg'), 'info', 'Take exactly these pieces from the storeroom.');
};
window.lnMoveSubmit = async () => {
  try { await api('POST', '/linen/move', { codes: LN.mv.codes, to: LN.mv.to }); closeModal(); await lnReload(); }
  catch (e) { notice($('#mvMsg'), 'err', e.message); }
};

// ----------------------------------------------------------------- damage ---
window.lnOpenDamage = (code) => {
  LN.dmg = { codes: code ? [code] : [], reason: 'damaged', note: '' };
  lnDrawDamage();
};
function lnDrawDamage() {
  const g = LN.dmg;
  openModal(`
    <button class="ghost small close" onclick="closeModal()">✕</button>
    <h3>Report damage</h3><div id="dmgMsg"></div>
    <p class="hint" style="margin:0 0 8px">These pieces leave stock and show in the loss report. Scan each one.</p>
    ${lnScanField('dmgScan')}
    <div class="ln-chips">${g.codes.map((c, i) => `<span class="ln-chip"><b>${c}</b> ${esc(lnTypeName(lnPiece(c).typeId))} <button onclick="LN.dmg.codes.splice(${i},1);lnDrawDamage()" aria-label="Remove">✕</button></span>`).join('')}</div>
    <div class="row"><div><label>Reason</label><select id="dmgReason" onchange="LN.dmg.reason=this.value"><option value="damaged" ${g.reason === 'damaged' ? 'selected' : ''}>Damaged (torn, burnt, stained for good)</option><option value="worn" ${g.reason === 'worn' ? 'selected' : ''}>Worn out</option></select></div></div>
    <label>What happened, and what you did with it</label>
    <input id="dmgNote" value="${esc(g.note)}" oninput="LN.dmg.note=this.value" placeholder="e.g. burn mark, kept as cleaning rag">
    <div class="ln-foot"><button class="danger" onclick="lnDamageSubmit()" ${g.codes.length ? '' : 'disabled'}>Take out of stock</button></div>`);
  lnBindScan('dmgScan', (code) => {
    const p = lnPiece(code);
    if (!p) return { err: `${code} isn't a known piece.` };
    if (p.status === 'retired') return { err: `${code} is already out of stock.` };
    if (p.status === 'washing') return { err: `${code} is in a wash batch. Mark it damaged when the batch is received.` };
    if (g.codes.includes(code)) return { err: `${code} already scanned.` };
    g.codes.push(code); lnDrawDamage();
    return { ok: `${code} ${lnTypeName(p.typeId)}` };
  });
}
window.lnDamageSubmit = async () => {
  const g = LN.dmg;
  if (!g.note.trim()) return notice($('#dmgMsg'), 'err', 'Say what happened.');
  try { await api('POST', '/linen/retire', { codes: g.codes, reason: g.reason, note: g.note }); closeModal(); await lnReload(); }
  catch (e) { notice($('#dmgMsg'), 'err', e.message); }
};

// ----------------------------------------------------------------- pieces ---
function lnPieces(v) {
  const d = LN.doc, f = LN.pieceFilter;
  const q = f.q.trim().toUpperCase();
  const rows = d.pieces.filter((p) => (!f.status || p.status === f.status) && (!f.type || p.typeId === f.type)
    && (!f.loc || (p.status === 'clean' && p.loc === f.loc) || (p.status === 'in_use' && p.room === f.loc)) && (!q || p.code.includes(q)));
  const shown = rows.slice(0, 300);
  v.innerHTML = `
    <div class="ln-head"><div><h2>Pieces</h2><p class="hint">Every labelled piece. Scan a label to see where it should be and everywhere it's been.</p></div>
      ${can('linenManage') && rows.length ? `<button class="secondary small" onclick="lnPrintFiltered()">Print labels for these ${rows.length}</button>` : ''}</div>
    <div class="card">${lnScanField('pcScan', 'Scan or type a code to look it up')}
      <div class="toolbar" style="margin-top:8px">
        <div><label>Status</label><select onchange="lnPF('status',this.value)"><option value="">Any</option>${Object.entries(LN_STATUS).map(([k, [l]]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${l} (${d.pieces.filter((p) => p.status === k).length})</option>`).join('')}</select></div>
        <div><label>Item</label><select onchange="lnPF('type',this.value)"><option value="">Any</option>${d.types.map((t) => `<option value="${t.id}" ${f.type === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
        <div><label>Room or store</label><select onchange="lnPF('loc',this.value)"><option value="">Anywhere</option><option value="store" ${f.loc === 'store' ? 'selected' : ''}>Storeroom</option>${d.rooms.map((r) => `<option value="${esc(r.name)}" ${f.loc === r.name ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
      </div></div>
    <div class="card"><div class="table-wrap"><table class="data"><thead><tr><th>Code</th><th>Item</th><th>Status</th><th>Where</th><th class="ln-n">Washes</th><th>Since</th></tr></thead><tbody>
      ${shown.map((p) => { const ty = lnType(p.typeId); const worn = p.washes >= ty.washLife * 0.9;
        return `<tr onclick="lnOpenPiece('${p.code}')"><td><b class="ln-code">${p.code}</b></td><td>${esc(ty.name)}</td><td>${lnStatusTag(p)}</td><td>${esc(lnWhere(p))}</td><td class="ln-n" ${worn ? 'style="color:var(--warn);font-weight:700"' : ''}>${p.washes}/${ty.washLife}</td><td class="muted">${fmt(p.statusAt)}</td></tr>`; }).join('') || '<tr><td colspan="6" class="muted">No pieces match.</td></tr>'}
    </tbody></table></div>${rows.length > shown.length ? `<p class="hint">Showing the first ${shown.length} of ${rows.length}. Narrow the filters to see more.</p>` : ''}</div>`;
  lnBindScan('pcScan', (code) => {
    if (!lnPiece(code)) return { err: `${code} isn't a known piece.` };
    lnOpenPiece(code); return { ok: code };
  });
}
window.lnPF = (k, v) => { LN.pieceFilter[k] = v; lnGo('pieces'); };
window.lnPrintFiltered = () => {
  const f = LN.pieceFilter;
  const codes = LN.doc.pieces.filter((p) => (!f.status || p.status === f.status) && (!f.type || p.typeId === f.type)
    && (!f.loc || (p.status === 'clean' && p.loc === f.loc) || (p.status === 'in_use' && p.room === f.loc))).map((p) => p.code);
  lnPrintLabels(codes);
};
window.lnOpenLookup = () => {
  openModal(`<button class="ghost small close" onclick="closeModal()">✕</button><h3>Look up a piece</h3>${lnScanField('luScan', 'Scan or type a code')}`);
  lnBindScan('luScan', (code) => { if (!lnPiece(code)) return { err: `${code} isn't a known piece.` }; lnOpenPiece(code); return { ok: code }; });
};
window.lnOpenPiece = async (code) => {
  let h;
  try { h = await api('GET', `/linen/piece/${encodeURIComponent(code)}`); } catch (e) { return alert(e.message); }
  const p = h.piece, ty = lnType(p.typeId);
  const life = Math.min(100, Math.round(p.washes / ty.washLife * 100));
  const acts = [];
  if (p.status === 'missing' && (can('linenUse') || can('linenWash'))) acts.push(`<button class="small" onclick="lnFound('${p.code}')">Found it</button>`);
  if (p.status === 'missing' && can('linenManage')) acts.push(`<button class="small secondary" onclick="lnWriteOff('${p.code}')">Write off</button>`);
  if (!['retired', 'washing'].includes(p.status) && (can('linenUse') || can('linenWash'))) acts.push(`<button class="small danger" onclick="lnOpenDamage('${p.code}')">Report damage</button>`);
  if (can('linenManage')) acts.push(`<button class="small secondary" onclick="lnPrintCodes(['${p.code}'])">Print label</button>`);
  openModal(`
    <button class="ghost small close" onclick="closeModal()">✕</button>
    <h3><span class="ln-code">${p.code}</span> · ${esc(ty.name)}</h3><div id="pcMsg"></div>
    <table class="data" style="min-width:0;margin-bottom:12px"><tbody>
      <tr><td class="muted">Status</td><td>${lnStatusTag(p)}</td></tr>
      <tr><td class="muted">Where</td><td>${esc(lnWhere(p))}</td></tr>
      <tr><td class="muted">Since</td><td>${fmt(p.statusAt)}</td></tr>
      <tr><td class="muted">Washes</td><td>${p.washes} of about ${ty.washLife} <div class="ln-bar" style="max-width:160px;display:inline-block;vertical-align:middle;margin-left:6px"><i style="width:${life}%;background:${life >= 90 ? 'var(--warn)' : 'var(--accent)'}"></i></div></td></tr>
      <tr><td class="muted">Added</td><td>${fmt(p.addedAt)}${p.supplier ? ` · ${esc(p.supplier)}` : ''}${p.cost ? ` · ${money(p.cost)}` : ''}</td></tr>
    </tbody></table>
    ${acts.length ? `<div class="ln-filters" style="margin-bottom:12px">${acts.join('')}</div>` : ''}
    <div class="ln-sec">History</div>
    ${h.history.map((l) => `<div class="log"><b>${esc(l.by)}</b> — ${esc(l.action)}${l.detail ? ': ' + esc(l.detail) : ''}<br><span class="muted" style="font-size:11px">${fmt(l.at)}</span></div>`).join('') || '<p class="muted">Nothing yet.</p>'}`);
};
window.lnFound = async (code) => {
  openModal(`<button class="ghost small close" onclick="closeModal()">✕</button><h3>Found ${code}</h3><div id="fdMsg"></div>
    <label>What state is it in?</label>
    <select id="fdAs" onchange="$('#fdLocBox').style.display=this.value==='clean'?'block':'none'"><option value="soiled">Dirty or not sure: soiled bin</option><option value="clean">Clean and folded</option></select>
    <div id="fdLocBox" style="display:none"><label>Where is it now</label><select id="fdLoc">${lnLocOptions('store')}</select></div>
    <button class="btn-full" style="margin-top:14px" onclick="lnFoundSubmit('${code}')">Save</button>`);
};
window.lnFoundSubmit = async (code) => {
  try { await api('POST', '/linen/found', { codes: [code], as: $('#fdAs').value, loc: $('#fdLoc').value }); closeModal(); await lnReload(); }
  catch (e) { notice($('#fdMsg'), 'err', e.message); }
};
window.lnWriteOff = (code) => {
  openModal(`<button class="ghost small close" onclick="closeModal()">✕</button><h3>Write off ${code}</h3><div id="woMsg"></div>
    <label>Outcome</label><select id="woReason"><option value="lost">Lost</option><option value="charged">Charged to a guest</option></select>
    <label>Note</label><input id="woNote" placeholder="e.g. charged to guest in Akoma, receipt 1043">
    <button class="btn-full danger" style="margin-top:14px" onclick="lnWriteOffSubmit('${code}')">Write off</button>`);
};
window.lnWriteOffSubmit = async (code) => {
  try { await api('POST', '/linen/retire', { codes: [code], reason: $('#woReason').value, note: $('#woNote').value.trim() }); closeModal(); await lnReload(); }
  catch (e) { notice($('#woMsg'), 'err', e.message); }
};

// ---------------------------------------------------------------- reports ---
function lnRangeStart() {
  const n = new Date();
  if (LN.range === 'month') return new Date(n.getFullYear(), n.getMonth(), 1);
  if (LN.range === '3m') return new Date(n.getFullYear(), n.getMonth() - 2, 1);
  if (LN.range === 'year') return new Date(n.getFullYear(), 0, 1);
  return new Date(0);
}
function lnReports(v) {
  const d = LN.doc;
  const from = lnRangeStart();
  const costOf = (p) => p.cost || lnType(p.typeId).cost || 0;
  const retired = d.pieces.filter((p) => p.status === 'retired' && new Date(p.statusAt) >= from);
  const missing = d.pieces.filter((p) => p.status === 'missing');
  const lost = retired.filter((p) => p.retiredReason === 'lost' || p.retiredReason === 'charged');
  const dmg = retired.filter((p) => p.retiredReason === 'damaged' || p.retiredReason === 'worn');
  const active = d.pieces.filter(lnActive).length;
  const sumCost = (arr) => arr.reduce((a, p) => a + costOf(p), 0);
  const lossRate = active + missing.length ? ((lost.length + missing.length) / (active + missing.length + lost.length) * 100) : 0;
  // Last six months of pieces leaving stock.
  const months = [];
  const n = new Date();
  for (let i = 5; i >= 0; i--) {
    const s = new Date(n.getFullYear(), n.getMonth() - i, 1), e = new Date(n.getFullYear(), n.getMonth() - i + 1, 1);
    const inM = d.pieces.filter((p) => p.status === 'retired' && new Date(p.statusAt) >= s && new Date(p.statusAt) < e);
    months.push({ label: s.toLocaleString('en-GB', { month: 'short' }), lost: inM.filter((p) => ['lost', 'charged'].includes(p.retiredReason)).length, dmg: inM.filter((p) => ['damaged', 'worn'].includes(p.retiredReason)).length });
  }
  const mx = Math.max(1, ...months.map((m) => m.lost + m.dmg));
  const need = lnNeedPerType();
  const reorder = lnTypesInUse().map((ty) => {
    const owned = d.pieces.filter((p) => p.typeId === ty.id && lnActive(p)).length;
    const worn = d.pieces.filter((p) => p.typeId === ty.id && lnActive(p) && p.washes >= ty.washLife * 0.9).length;
    const target = (need[ty.id] || 0) * d.par;
    return { ty, owned, worn, target, buy: Math.max(0, target - owned + worn) };
  }).filter((r) => r.buy > 0);
  const wornList = d.pieces.filter((p) => lnActive(p) && p.washes >= lnType(p.typeId).washLife * 0.9);
  const sources = {};
  missing.forEach((p) => { const k = (p.missingFrom || 'Unknown').replace(/ (W-\d+|count)$/, ''); sources[k] = (sources[k] || 0) + 1; });
  v.innerHTML = `
    <div class="ln-head"><div><h2>Losses & reorder</h2><p class="hint">What went missing or was damaged, what it cost, and what to buy.</p></div>
      <div class="toolbar"><div><label>Period</label><select onchange="LN.range=this.value;lnGo('reports')">${[['month', 'This month'], ['3m', 'Last 3 months'], ['year', 'This year'], ['all', 'All time']].map(([k, l]) => `<option value="${k}" ${LN.range === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <button class="secondary small" onclick="lnExportCsv()">Export all pieces (CSV)</button></div></div>
    <div class="stats">
      <div class="stat"><div class="k">Missing now</div><div class="v" style="color:${missing.length ? 'var(--danger)' : 'inherit'}">${missing.length}</div><div class="muted" style="font-size:12px">${money(sumCost(missing))} to replace</div></div>
      <div class="stat"><div class="k">Lost / charged</div><div class="v">${lost.length}</div><div class="muted" style="font-size:12px">${money(sumCost(lost))} in this period</div></div>
      <div class="stat"><div class="k">Damaged / worn</div><div class="v">${dmg.length}</div><div class="muted" style="font-size:12px">${money(sumCost(dmg))} in this period</div></div>
      <div class="stat"><div class="k">Loss rate</div><div class="v">${lossRate.toFixed(1)}%</div><div class="muted" style="font-size:12px">lost + missing, of stock</div></div>
    </div>
    <div class="card"><h3 style="margin:0 0 8px">Pieces out of stock, by month</h3>
      <div class="ln-chart">${months.map((m) => `<div><div class="ln-col"><span class="ln-c-miss" style="height:${m.lost / mx * 100}%" title="Lost or charged: ${m.lost}"></span><span class="ln-c-soiled" style="height:${m.dmg / mx * 100}%" title="Damaged or worn: ${m.dmg}"></span></div><b>${m.lost + m.dmg}</b><span>${m.label}</span></div>`).join('')}</div>
      <div class="ln-legend"><span><i class="ln-c-miss"></i>Lost or charged</span><span><i class="ln-c-soiled"></i>Damaged or worn</span></div></div>
    ${missing.length ? `<div class="card"><h3 style="margin:0 0 8px">Where missing pieces went missing</h3>
      <div class="table-wrap"><table class="data" style="min-width:0"><tbody>${Object.entries(sources).sort((a, b) => b[1] - a[1]).map(([k, n2]) => `<tr><td>${esc(k)}</td><td class="ln-n"><b>${n2}</b></td></tr>`).join('')}</tbody></table></div>
      <button class="small secondary" style="margin-top:8px" onclick="lnShowMissing()">See each missing piece</button></div>` : ''}
    <div class="card"><h3 style="margin:0 0 4px">Reorder list</h3><p class="hint">Brings every item back to ${d.par} sets per bed and bathroom, and replaces pieces near the end of their life.</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>Item</th><th class="ln-n">Owned</th><th class="ln-n">Wearing out</th><th class="ln-n">Target</th><th class="ln-n">Buy</th><th class="ln-n">Est. cost</th></tr></thead><tbody>
      ${reorder.map((r) => `<tr><td>${esc(r.ty.name)}</td><td class="ln-n">${r.owned}</td><td class="ln-n">${r.worn}</td><td class="ln-n">${r.target}</td><td class="ln-n"><b>${r.buy}</b></td><td class="ln-n">${r.ty.cost ? money(r.buy * r.ty.cost) : '<span class="muted">set a price</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Everything is on target.</td></tr>'}
      ${reorder.length ? `<tr><td colspan="5"><b>Total</b></td><td class="ln-n"><b>${money(reorder.reduce((a, r) => a + r.buy * r.ty.cost, 0))}</b></td></tr>` : ''}
      </tbody></table></div></div>
    ${wornList.length ? `<div class="card"><h3 style="margin:0 0 8px">Near the end of their life</h3><p class="hint">${wornList.map((p) => `<a href="#" onclick="lnOpenPiece('${p.code}');return false">${p.code}</a> (${esc(lnTypeName(p.typeId))}, ${p.washes} washes)`).join(', ')}</p></div>` : ''}`;
}
window.lnExportCsv = () => {
  const rows = [['Code', 'Item', 'Status', 'Where', 'Washes', 'Wash life', 'Cost', 'Supplier', 'Added', 'Since']];
  LN.doc.pieces.forEach((p) => { const ty = lnType(p.typeId); rows.push([p.code, ty.name, (LN_STATUS[p.status] || [p.status])[0], lnWhere(p), p.washes, ty.washLife, p.cost || ty.cost || 0, p.supplier || '', p.addedAt, p.statusAt]); });
  const csv = rows.map((r) => r.map((x) => { const s = String(x ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `linen-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
};

// --------------------------------------------------------------- activity ---
function lnActivity(v) {
  const log = LN.doc.log.slice().reverse();
  v.innerHTML = `<div class="ln-head"><div><h2>Activity</h2><p class="hint">Every move, who made it and when.</p></div></div>
    <div class="card"><div class="table-wrap"><table class="data"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead><tbody>
    ${log.map((l) => `<tr><td class="muted" style="white-space:nowrap">${fmt(l.at)}</td><td>${esc(l.by)}</td><td><b>${esc(l.action)}</b></td><td>${esc(l.detail || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nothing yet.</td></tr>'}
    </tbody></table></div></div>`;
}

// ------------------------------------------------------------------ setup ---
function lnSetup(v) {
  const d = LN.doc;
  if (!LN.draft) {
    LN.draft = JSON.parse(JSON.stringify({ par: d.par, bedChangeDays: d.bedChangeDays, towelChangeDays: d.towelChangeDays, washAlertHours: d.washAlertHours, types: d.types, bedSizes: Object.entries(d.bedSets).map(([name, set]) => ({ name, originalName: name, set })), rooms: d.rooms.map((r) => ({ ...r, originalName: r.name })) }));
  }
  const g = LN.draft;
  const bedTypes = g.types.filter((t) => t.category === 'bed' && t.active);
  const bathTypes = g.types.filter((t) => t.category === 'bath' && t.active);
  const settingsRooms = (state.settings?.rooms || []).filter((n) => !g.rooms.some((r) => r.name === n));
  v.innerHTML = `
    <div class="ln-head"><div><h2>Linen setup</h2><p class="hint">Rooms, what each bed and bathroom takes, and your items. Save at the bottom.</p></div></div>
    <div id="setupMsg"></div>
    <div class="card"><h3 style="margin:0 0 6px">Add new linen</h3><p class="hint">New pieces go in clean. Print their labels straight away and fix one to each piece.</p>
      <div class="toolbar">
        <div><label>Item</label><select id="nsType">${d.types.filter((t) => t.active).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
        <div><label>How many</label><input id="nsQty" type="number" min="1" max="500" value="10"></div>
        <div><label>Unit cost (${esc(cur())})</label><input id="nsCost" type="number" min="0" step="0.01" placeholder="optional"></div>
        <div><label>Supplier</label><input id="nsSup" placeholder="optional"></div>
        <div><label>Goes to</label><select id="nsLoc">${lnLocOptions('store')}</select></div>
        <button onclick="lnAddStock()">Add</button>
      </div>
      ${LN.lastCodes.length ? `<div class="notice ok">Added ${LN.lastCodes[0]}–${LN.lastCodes[LN.lastCodes.length - 1]}. <button class="small" onclick="lnPrintCodes(LN.lastCodes)">Print ${LN.lastCodes.length} labels</button></div>` : ''}
    </div>
    <div class="card"><h3 style="margin:0 0 6px">Targets & timing</h3>
      <div class="toolbar">
        <div><label>Sets per bed / bathroom</label><input type="number" min="1" max="10" value="${g.par}" oninput="LN.draft.par=+this.value"></div>
        <div><label>Change beds every (days)</label><input type="number" min="1" value="${g.bedChangeDays}" oninput="LN.draft.bedChangeDays=+this.value"></div>
        <div><label>Change towels every (days)</label><input type="number" min="1" value="${g.towelChangeDays}" oninput="LN.draft.towelChangeDays=+this.value"></div>
        <div><label>Flag a wash after (hours)</label><input type="number" min="1" value="${g.washAlertHours}" oninput="LN.draft.washAlertHours=+this.value"></div>
      </div></div>
    <div class="card"><h3 style="margin:0 0 6px">Items</h3><p class="hint">Bed items go on beds; bath items are set per room. Wash life is roughly how many washes a piece lasts. The colour is the stripe on the label and the picture staff see.</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>Colour</th><th>Name</th><th>Kind</th><th>Unit cost</th><th>Wash life</th><th>In use</th></tr></thead><tbody>
      ${g.types.map((t, i) => `<tr><td><input type="color" value="${esc(t.color || '#64748b')}" onchange="LN.draft.types[${i}].color=this.value" aria-label="Colour for ${esc(t.name)}" style="width:46px;height:38px;padding:2px"></td><td><input value="${esc(t.name)}" oninput="LN.draft.types[${i}].name=this.value"></td>
        <td><select onchange="LN.draft.types[${i}].category=this.value;lnGo('setup')"><option value="bed" ${t.category === 'bed' ? 'selected' : ''}>Bed</option><option value="bath" ${t.category === 'bath' ? 'selected' : ''}>Bath</option></select></td>
        <td><input type="number" min="0" step="0.01" value="${t.cost}" oninput="LN.draft.types[${i}].cost=+this.value" style="max-width:110px"></td>
        <td><input type="number" min="10" value="${t.washLife}" oninput="LN.draft.types[${i}].washLife=+this.value" style="max-width:100px"></td>
        <td><input type="checkbox" style="width:auto" ${t.active ? 'checked' : ''} onchange="LN.draft.types[${i}].active=this.checked;lnGo('setup')"></td></tr>`).join('')}
      </tbody></table></div>
      <button class="small secondary" style="margin-top:8px" onclick="LN.draft.types.push({name:'New item',category:'bed',cost:0,washLife:200,active:true});lnGo('setup')">+ Add item</button></div>
    <div class="card"><h3 style="margin:0 0 6px">What each bed takes</h3>
      <p class="hint">Name your own bed sizes (e.g. Bunk, Super king). Renaming a size renames it on every bed; a size can only be removed once no bed uses it.</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>Bed size</th>${bedTypes.map((t) => `<th>${esc(t.name)}</th>`).join('')}<th></th></tr></thead><tbody>
      ${g.bedSizes.map((z, zi) => `<tr><td><input value="${esc(z.name)}" onchange="lnRenameSize(${zi},this.value)" aria-label="Bed size name" style="max-width:160px"></td>${bedTypes.map((t) => `<td><input type="number" min="0" max="20" value="${(z.set || {})[t.id] || 0}" oninput="lnSetQty(LN.draft.bedSizes[${zi}],'set','${t.id}',this.value)" style="max-width:80px"></td>`).join('')}
        <td><button class="small ghost" onclick="lnRemoveSize(${zi})" aria-label="Remove bed size">✕</button></td></tr>`).join('')}
      </tbody></table></div>
      <button class="small secondary" style="margin-top:8px" onclick="lnAddSize()">+ Add bed size</button></div>
    <div class="card"><h3 style="margin:0 0 6px">Rooms</h3><p class="hint">Each bed, the room's towels, and whether the room has its own linen cupboard.</p>
      <button class="small secondary" onclick="lnPrintRoomCards()">Print room door cards</button>
      ${settingsRooms.length ? `<button class="small secondary" onclick="lnImportRooms()">Add ${settingsRooms.length} room(s) from Settings → Rooms</button>` : ''}
      <div class="ln-setrooms">${g.rooms.map((r, ri) => `
        <div class="ln-setroom">
          <div class="toolbar"><div><label>Room name</label><input value="${esc(r.name)}" oninput="LN.draft.rooms[${ri}].name=this.value"></div>
            <label class="ln-cb" style="align-self:flex-end;margin-bottom:10px"><input type="checkbox" ${r.cupboard ? 'checked' : ''} onchange="LN.draft.rooms[${ri}].cupboard=this.checked"> Has a cupboard</label>
            <button class="small danger" onclick="LN.draft.rooms.splice(${ri},1);lnGo('setup')">Remove room</button></div>
          <label>Beds</label>
          ${r.beds.map((b, bi) => `<div class="ln-bedrow"><input value="${esc(b.label)}" oninput="LN.draft.rooms[${ri}].beds[${bi}].label=this.value" placeholder="e.g. Bed 1">
            <select onchange="LN.draft.rooms[${ri}].beds[${bi}].size=this.value">${g.bedSizes.map((z) => `<option value="${esc(z.name)}" ${b.size === z.name ? 'selected' : ''}>${esc(z.name)}</option>`).join('')}</select>
            <button class="small ghost" onclick="LN.draft.rooms[${ri}].beds.splice(${bi},1);lnGo('setup')" aria-label="Remove bed">✕</button></div>`).join('')}
          <button class="small secondary" onclick="LN.draft.rooms[${ri}].beds.push({label:'Bed ${r.beds.length + 1}',size:lnDefaultSize()});lnGo('setup')">+ Bed</button>
          ${bathTypes.length ? `<label>Towels for the room</label><div class="ln-towels">${bathTypes.map((t) => `<span><input type="number" min="0" max="20" value="${(r.towels || {})[t.id] || 0}" oninput="lnSetQty(LN.draft.rooms[${ri}],'towels','${t.id}',this.value)"> ${esc(t.name)}</span>`).join('')}</div>` : ''}
        </div>`).join('')}</div>
      <button class="small secondary" style="margin-top:10px" onclick="LN.draft.rooms.push({name:'',cupboard:false,beds:[{label:'Bed 1',size:lnDefaultSize()}],towels:{}});lnGo('setup')">+ Add room</button></div>
    <div class="ln-savebar"><button class="secondary" onclick="LN.draft=null;lnGo('setup')">Undo changes</button><button onclick="lnSaveSetup()">Save setup</button></div>`;
}
window.lnSetQty = (obj, key, typeId, val) => { obj[key] = obj[key] || {}; const n = Math.max(0, Math.round(+val || 0)); if (n) obj[key][typeId] = n; else delete obj[key][typeId]; };
// Bed sizes are the admin's own list. A rename moves every bed of that size with it.
window.lnDefaultSize = () => { const z = LN.draft.bedSizes; return (z.find((x) => x.name === 'Double') || z[0] || { name: '' }).name; };
window.lnRenameSize = (zi, val) => {
  const z = LN.draft.bedSizes[zi], name = String(val).trim();
  if (!name || LN.draft.bedSizes.some((x, i) => i !== zi && x.name.toLowerCase() === name.toLowerCase())) {
    alert(name ? `There is already a "${name}" size.` : 'A bed size needs a name.'); return lnGo('setup');
  }
  LN.draft.rooms.forEach((r) => r.beds.forEach((b) => { if (b.size === z.name) b.size = name; }));
  z.name = name; lnGo('setup');
};
window.lnRemoveSize = (zi) => {
  const z = LN.draft.bedSizes[zi];
  const using = LN.draft.rooms.filter((r) => r.beds.some((b) => b.size === z.name)).map((r) => r.name);
  if (using.length) return alert(`${z.name} beds are still in ${using.join(', ')}. Change those beds to another size first.`);
  if (LN.draft.bedSizes.length === 1) return alert('Keep at least one bed size.');
  LN.draft.bedSizes.splice(zi, 1); lnGo('setup');
};
window.lnAddSize = () => {
  let n = 'New size', i = 2;
  while (LN.draft.bedSizes.some((x) => x.name === n)) n = `New size ${i++}`;
  LN.draft.bedSizes.push({ name: n, set: {} }); lnGo('setup');
};
window.lnImportRooms = () => {
  (state.settings?.rooms || []).filter((n) => !LN.draft.rooms.some((r) => r.name === n))
    .forEach((n) => LN.draft.rooms.push({ name: n, cupboard: false, beds: [{ label: 'Bed 1', size: lnDefaultSize() }], towels: {} }));
  lnGo('setup');
};
window.lnSaveSetup = async () => {
  try {
    await api('PUT', '/linen/setup', LN.draft);
    LN.draft = null; await lnReload();
    notice($('#setupMsg'), 'ok', 'Setup saved.');
  } catch (e) { notice($('#setupMsg'), 'err', e.message); window.scrollTo(0, 0); }
};
window.lnAddStock = async () => {
  try {
    const r = await api('POST', '/linen/pieces', { typeId: $('#nsType').value, qty: +$('#nsQty').value, cost: $('#nsCost').value, supplier: $('#nsSup').value, loc: $('#nsLoc').value });
    LN.lastCodes = r.codes;
    await lnReload();
  } catch (e) { notice($('#setupMsg'), 'err', e.message); window.scrollTo(0, 0); }
};
