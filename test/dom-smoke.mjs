// Browser smoke test: load the actual HTML + JS in jsdom against the real API
// (file-store) and drive the UI the way a receptionist would. Catches runtime
// reference errors and verifies rendering/interaction wiring.

import { JSDOM } from 'jsdom';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const dir = mkdtempSync(path.join(os.tmpdir(), 'laundry-dom-'));
process.env.FORCE_FILE_STORE = '1';
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = 'dom-secret';
delete process.env.RESEND_API_KEY;

const { handleRequest } = await import('../netlify/functions/api.js');

// A fetch() shim that routes /api to handleRequest and reads local files otherwise.
function makeFetch() {
  return async (url, opts = {}) => {
    const u = new URL(url, 'http://localhost');
    if (u.pathname.startsWith('/api/')) {
      const query = Object.fromEntries(u.searchParams.entries());
      let body = {}; try { body = opts.body ? JSON.parse(opts.body) : {}; } catch {}
      const r = await handleRequest({ method: opts.method || 'GET', path: u.pathname, query, body, headers: opts.headers || {} });
      const payload = r.contentType === 'text/csv' ? r.body : JSON.stringify(r.body);
      return {
        ok: r.status < 400, status: r.status,
        headers: { get: () => (r.contentType || 'application/json') },
        json: async () => (typeof r.body === 'string' ? JSON.parse(r.body) : r.body),
        text: async () => payload, blob: async () => payload,
      };
    }
    // static asset
    const file = path.join(ROOT, 'public', u.pathname.replace(/^\//, ''));
    return { ok: true, status: 200, headers: { get: () => 'text/javascript' }, text: async () => readFileSync(file, 'utf8') };
  };
}

let pass = 0, fail = 0; const out = [];
const ok = (n, c, x = '') => { if (c) { pass++; out.push(`  ✅ ${n}`); } else { fail++; out.push(`  ❌ ${n} ${x}`); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function loadPage(htmlFile, jsFile, { search = '' } = {}) {
  const html = readFileSync(path.join(ROOT, 'public', htmlFile), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: `http://localhost${search ? '/track' + search : '/'}`, pretendToBeVisual: true });
  const { window } = dom;
  window.fetch = makeFetch();
  window.QRCode = function (el) { el.innerHTML = '<canvas></canvas>'; }; // stub CDN lib
  window.QRCode.CorrectLevel = { M: 0 };
  window.alert = () => {}; window.confirm = () => true; window.prompt = () => 'x';
  window.scrollTo = () => {};
  global.window = window; global.document = window.document; global.localStorage = window.localStorage;
  global.fetch = window.fetch; global.FileReader = window.FileReader; global.URLSearchParams = window.URLSearchParams;
  // app.html loads guide.js, app.js and linen.js as separate classic scripts that
  // share one global scope. An eval of strict code gets its own scope, so run the
  // list as one script to share it the same way.
  window.eval([].concat(jsFile).map((f) => readFileSync(path.join(ROOT, 'public/assets', f), 'utf8')).join('\n;\n'));
  await sleep(60);
  return window;
}

try {
  // Seed: set up admin + settings + one order via API first.
  await handleRequest({ method: 'POST', path: '/api/setup', body: { hostelName: 'DOM Hostel', adminName: 'Ada', adminPin: '1234' } });
  const auth = await handleRequest({ method: 'POST', path: '/api/auth/pin', body: { pin: '1234' } });
  const H = { authorization: `Bearer ${auth.body.token}` };
  await handleRequest({ method: 'PUT', path: '/api/settings', headers: H, body: { currency: { code: 'USD', symbol: '$' }, pricePerLoad: 6, piecesPerLoad: 25 } });

  out.push('\n▶ Guest order page (order.js)');
  let w = await loadPage('order.html', 'order.js');
  ok('branding applied from settings', w.document.querySelector('#brandName').textContent === 'DOM Hostel', w.document.querySelector('#brandName').textContent);
  ok('order form shows payment choice (timing + method)', w.document.querySelectorAll('input[name="timing"]').length === 2 && w.document.querySelectorAll('input[name="method"]').length === 2);
  w.document.querySelector('#items').value = '30';
  w.document.querySelector('#items').dispatchEvent(new w.Event('input'));
  ok('load hint computes 2 loads for 30 items', /2 loads/.test(w.document.querySelector('#loadHint').textContent), w.document.querySelector('#loadHint').textContent);
  w.document.querySelector('#name').value = 'Zoe Q';
  w.document.querySelector('#email').value = 'zoe@example.com';
  w.document.querySelector('#orderForm').dispatchEvent(new w.Event('submit'));
  await sleep(80);
  ok('order submits & shows confirmation', !w.document.querySelector('#doneCard').classList.contains('hidden'));
  ok('track link populated', /\/track\?id=pub_/.test(w.document.querySelector('#trackLink').href), w.document.querySelector('#trackLink').href);

  out.push('\n▶ Reception app (app.js) — setup already done, so shows lock screen');
  w = await loadPage('app.html', ['guide.js', 'app.js', 'linen.js']);
  ok('lock screen visible (not setup)', !w.document.querySelector('#lockScreen').classList.contains('hidden'));
  ok('PIN pad rendered', w.document.querySelectorAll('#pinpad button').length === 12);
  // keyboard PIN entry works on the lock screen
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: '7' }));
  ok('keyboard digit updates the PIN', w.document.querySelector('#pinDots').textContent.includes('•'));
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Backspace' }));
  ok('keyboard backspace clears it', w.document.querySelector('#pinDots').textContent.trim() === '');
  // enter admin PIN via the pad
  ['1', '2', '3', '4', 'OK'].forEach(k => [...w.document.querySelectorAll('#pinpad button')].find(b => b.textContent === k).click());
  await sleep(120);
  ok('app shell shown after correct PIN', !w.document.querySelector('#app').classList.contains('hidden'));
  ok('admin sees all tabs (orders,linen,messages,reports,cashiers,settings,guide)', w.document.querySelectorAll('#tabs button').length === 7, w.document.querySelectorAll('#tabs button').length + '');
  ok('who-name shows Ada', w.document.querySelector('#whoName').textContent === 'Ada');
  await sleep(60);
  ok('orders board rendered with the guest order', /Zoe Q/.test(w.document.querySelector('#view').innerHTML), 'no order in view');
  ok('new order shows Accept button', /Accept/.test(w.document.querySelector('#view').innerHTML));
  ok('sound mute button present in topbar', !!w.document.querySelector('#muteBtn'));
  ok('shift bar offers Start shift', /Start shift/.test(w.document.querySelector('#view').innerHTML));
  // open the start-shift modal (laundry handover — acknowledge, no cash float)
  w.openStartShift();
  ok('start-shift modal auto-selects shift (no chooser), has acknowledgement, no cash float', !!w.document.querySelector('#shAck') && !w.document.querySelector('#shType') && !w.document.querySelector('#shFloat'));
  w.closeModal();
  ok('admin-selected hover colour applied (--hover)', w.document.documentElement.style.getPropertyValue('--hover').toUpperCase() === '#FFF8ED');

  // shift-boundary lock UI (render the banner directly)
  w.__test.state.shiftEnded = { shiftId: 'x', starterId: 'y', starterName: 'Ada', oldType: 'AM', newType: 'PM' };
  w.__test.state.continueMode = false;
  w.__test.renderShiftEndBanner();
  ok('shift-end lock shows continue + new-shift buttons', !!w.document.querySelector('#btnContinueShift') && !!w.document.querySelector('#btnNewShift'));
  ok('lock heading reflects ended shift', /AM shift has ended/.test(w.document.querySelector('#lockScreen h2').textContent));
  w.__test.state.continueMode = true; w.__test.renderShiftEndBanner();
  ok('continue mode asks for starter PIN', /Ada/.test(w.document.querySelector('#lockScreen .hint').textContent));
  w.__test.state.shiftEnded = null; w.__test.renderShiftEndBanner(); // reset

  // open settings tab and verify currency + QR render
  [...w.document.querySelectorAll('#tabs button')].find(b => b.dataset.tab === 'settings').click();
  await sleep(80);
  ok('settings shows currency select', !!w.document.querySelector('#stCurrency'));
  ok('QR code drawn', !!w.document.querySelector('#qrbox canvas, #qrbox img'));

  // cashiers tab: open add-cashier modal and confirm permission checkboxes exist
  [...w.document.querySelectorAll('#tabs button')].find(b => b.dataset.tab === 'cashiers').click();
  await sleep(80);
  w.openCashier();
  ok('add-cashier modal has permission checkboxes', w.document.querySelectorAll('[data-perm]').length >= 8, w.document.querySelectorAll('[data-perm]').length + '');
  w.closeModal();

  // guide tab: the built-in laundry handbook
  [...w.document.querySelectorAll('#tabs button')].find(b => b.dataset.tab === 'guide').click();
  await sleep(80);
  const gv = w.document.querySelector('#view');
  ok('guide tab renders the handbook', /Laundry Handbook/.test(gv.innerHTML) && gv.querySelectorAll('.guide-sec').length >= 12, gv.querySelectorAll('.guide-sec').length + ' sections');
  ok('guide names the real app buttons', ['Mark ready', 'Start cleaning', 'Confirm received', 'Pick for me'].every(n => [...gv.querySelectorAll('kbd.ui')].some(k => k.textContent === n)), [...gv.querySelectorAll('kbd.ui')].map(k => k.textContent).join(','));
  ok('guide carries none of the old wording', !/quest|password|Start Washing|Done ☑/i.test(gv.textContent));
  ok('guide has the order flow and the who-to-ask table', !!gv.querySelector('#g-flow ol') && !!gv.querySelector('#g-limits table'));
  ok('reception/admin see the pointer note; it is not for attendants', /attendants' guide/.test(gv.innerHTML));
  const boxes = gv.querySelectorAll('[data-ck]');
  ok('daily checklist is interactive', boxes.length >= 20, boxes.length + ' boxes');
  // runScripts:'outside-only' never fires inline onchange="" attributes, so do what the
  // attribute would: toggle the box and hand it to the handler (as the other tests do).
  boxes[0].checked = true; w.guideTick(boxes[0]); await sleep(20);
  ok('a tick is remembered on this device for today', /"ck0":1/.test(w.localStorage.getItem('guide-checklist-' + new Date().toISOString().slice(0, 10)) || ''));
  ok('progress counter follows the ticks', /^1 of \d+$/.test(w.document.querySelector('#guideProgress').textContent), w.document.querySelector('#guideProgress').textContent);
  w.guideResetChecklist();
  ok('reset clears the ticks', ![...gv.querySelectorAll('[data-ck]')].some(c => c.checked) && /^0 of/.test(w.document.querySelector('#guideProgress').textContent));

  out.push('\n▶ Linen tab (linen.js)');
  await handleRequest({ method: 'PUT', path: '/api/linen/setup', headers: H, body: { rooms: [
    { name: 'Akoma', cupboard: true, beds: [{ label: 'Bed', size: 'Double' }], towels: { htowel: 1, ftowel: 1 } },
  ] } });
  const added = await handleRequest({ method: 'POST', path: '/api/linen/pieces', headers: H, body: { typeId: 'dsheet', qty: 4 } });
  await handleRequest({ method: 'POST', path: '/api/linen/pieces', headers: H, body: { typeId: 'pcase', qty: 2 } });
  const tabBtn = [...w.document.querySelectorAll('#tabs button')].find(b => b.dataset.tab === 'linen');
  tabBtn.click(); await sleep(100);
  let lv = w.document.querySelector('#view');
  ok('linen overview renders counts and alerts', /Bed linen &amp; towels|Bed linen & towels/.test(lv.innerHTML) && /Needs attention/.test(lv.innerHTML), lv.innerHTML.slice(0, 200));
  ok('overview flags the bed that is not made up', /not made up/.test(lv.textContent));
  w.lnGo('rooms'); await sleep(80);
  ok('rooms view lists Akoma with its bed and towels', /Akoma/.test(w.document.querySelector('#lnView').textContent) && w.document.querySelectorAll('.ln-place').length === 2);
  w.lnOpenChange(0, 0); await sleep(20);
  const scan = (code) => { const el = w.document.querySelector('#chgScan'); el.value = code; el.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter' })); };
  scan(added.body.codes[0].toLowerCase());
  ok('scanning a clean sheet adds it (case-insensitive)', w.document.querySelectorAll('.ln-chip').length === 1, w.document.querySelector('#chgScanMsg').textContent);
  scan('L99999');
  ok('an unknown code shows an error', /isn't a known piece/.test(w.document.querySelector('#chgScanMsg').textContent));
  w.lnChgPick(); await sleep(10);
  ok('"Pick for me" fills the rest of the set', w.document.querySelectorAll('.ln-chip').length === 3 && /Full set/.test(w.document.querySelector('.modal').textContent));
  await w.lnChgSubmit(false); await sleep(80);
  let doc = (await handleRequest({ method: 'GET', path: '/api/linen', headers: H })).body;
  ok('the bed is made with 3 pieces', doc.pieces.filter(p => p.status === 'in_use').length === 3 && doc.rooms[0].beds[0].state === 'made');
  for (const sub of ['wash', 'stock', 'pieces', 'reports', 'activity', 'setup', 'overview']) {
    w.lnGo(sub); await sleep(60);
    const html = w.document.querySelector('#view').innerHTML;
    ok(`${sub} view renders without errors`, !/notice err/.test(html) && html.length > 200, html.slice(0, 160));
  }
  w.lnGo('setup'); await sleep(60);
  ok('setup shows bed sets and rooms', /What each bed takes/.test(w.document.querySelector('#view').textContent) && /Has a cupboard/.test(w.document.querySelector('#view').textContent));
  w.LN.draft.rooms[0].beds.push({ label: 'Bed 2', size: 'King' }); w.lnGo('setup'); await sleep(60);
  ok('setup draft survives a redraw', w.document.querySelectorAll('.ln-bedrow').length === 2);
  await w.lnSaveSetup(); await sleep(60);
  doc = (await handleRequest({ method: 'GET', path: '/api/linen', headers: H })).body;
  ok('saving setup adds the new bed', doc.rooms[0].beds.length === 2 && doc.rooms[0].beds[1].size === 'King');
  w.lnGo('setup'); await sleep(60);
  w.lnAddSize(); await sleep(30);
  const zi = w.LN.draft.bedSizes.length - 1;
  w.lnRenameSize(zi, 'Bunk'); await sleep(30);
  ok('admin can add and name a bed size, and beds can pick it', [...w.document.querySelectorAll('.ln-bedrow select option')].some((o) => o.value === 'Bunk'));
  w.lnRenameSize(w.LN.draft.bedSizes.findIndex((z) => z.name === 'King'), 'Super king'); await sleep(30);
  ok('renaming a size renames it on the beds in the draft', w.LN.draft.rooms[0].beds[1].size === 'Super king');
  await w.lnSaveSetup(); await sleep(60);
  doc = (await handleRequest({ method: 'GET', path: '/api/linen', headers: H })).body;
  ok('saved sizes include Bunk and the renamed Super king bed', !!doc.bedSets.Bunk && doc.rooms[0].beds[1].size === 'Super king' && !doc.bedSets.King);

  out.push('\n▶ Housekeeping sign-in');
  await handleRequest({ method: 'POST', path: '/api/cashiers', headers: H, body: { name: 'Ama', pin: '5555', role: 'housekeeping' } });
  w = await loadPage('app.html', ['guide.js', 'app.js', 'linen.js']);
  ['5', '5', '5', '5', 'OK'].forEach(k => [...w.document.querySelectorAll('#pinpad button')].find(b => b.textContent === k).click());
  await sleep(150);
  const hkTabs = [...w.document.querySelectorAll('#tabs button')].map(b => b.dataset.tab).join(',');
  ok('housekeeping sees only Linen and Guide', hkTabs === 'linen,guide', hkTabs);
  ok('housekeeping lands on the linen overview, no shift bar', /Needs attention/.test(w.document.querySelector('#view').textContent) && !/Start shift/.test(w.document.querySelector('#view').innerHTML));
  ok('housekeeping has no Setup or Losses screens', !/lnGo\('setup'\)|Losses &amp; reorder/.test(w.document.querySelector('.ln-subnav').innerHTML));
} catch (err) {
  fail++; out.push(`\n💥 ${err.stack || err}`);
}

console.log(out.join('\n'));
console.log(`\n${'─'.repeat(40)}\n${pass} passed, ${fail} failed`);
rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
