// Guest tracking + messaging page.
const $ = (s) => document.querySelector(s);
const publicId = new URLSearchParams(location.search).get('id');
let settings = { currency: { symbol: '' } };
let order = null;

const TITLES = { new: 'Waiting for reception', accepted: 'Accepted', cleaning: 'In the wash', ready: 'Ready for pickup', completed: 'Collected', cancelled: 'Cancelled' };
const LINES = {
  new: 'Bring your bag to reception. They’ll accept it and confirm the price.',
  accepted: 'Reception has your bag. It goes into the wash next.',
  cleaning: 'Your laundry is in the wash. We’ll email you when it’s ready.',
  ready: 'It’s folded and waiting for you at reception.',
  completed: 'Collected. Thanks for staying with us.',
  cancelled: 'This order was cancelled. Please ask at reception if that’s unexpected.',
};

async function loadBranding() {
  try {
    settings = await (await fetch('/api/public-settings')).json();
    if (settings.accentColor) {
      document.documentElement.style.setProperty('--accent', settings.accentColor);
      const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = settings.accentColor;
    }
    const name = settings.hostelName || 'Laundry Service';
    $('#brandName').textContent = name;
    document.title = `Track your Laundry · ${name}`;
    const mono = $('#brandMono');
    if (settings.logoDataUrl) {
      const img = document.createElement('img'); img.src = settings.logoDataUrl; img.alt = name; mono.replaceWith(img);
    } else {
      const w = name.trim().split(/\s+/); mono.textContent = ((w[0] || 'L')[0] + (w[1] ? w[1][0] : '')).toLowerCase();
    }
  } catch {}
}

function hm(iso) { return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
function when(iso) {
  if (!iso) return '';
  const d = new Date(iso), n = new Date();
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 864e5);
  if (days === 0) return 'Today ' + hm(iso); if (days === 1) return 'Tomorrow ' + hm(iso); if (days === -1) return 'Yesterday ' + hm(iso);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + hm(iso);
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function money(n) { const v = Number(n) || 0; return `${settings.currency?.symbol || ''}${Number.isInteger(v) ? v : v.toFixed(2)}`; }
const CHECK = '<svg class="i sm" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

function renderProgress(o) {
  const steps = [['Order placed', o.createdAt], ['Accepted at reception', o.acceptedAt], ['Washing', o.cleaningAt], ['Ready for pickup', o.readyAt], ['Collected', o.completedAt]];
  const order = ['new', 'accepted', 'cleaning', 'ready', 'completed'];
  const idx = o.status === 'cancelled' ? steps.reduce((m, s, i) => (s[1] ? i : m), 0) : order.indexOf(o.status);
  return steps.map(([label, t], i) => {
    const cls = o.status === 'cancelled' ? (i <= idx ? 'done' : 'todo') : (i < idx || (i === idx && i === 4) ? 'done' : i === idx ? 'now' : 'todo');
    const sub = t ? when(t) : (o.status !== 'cancelled' && i === idx + 1 ? 'Next' : '');
    return `<div class="vstep ${cls}"><span class="o">${cls === 'done' ? CHECK : ''}</span><span><b>${label}</b><small>${sub}</small></span></div>`;
  }).join('');
}

function renderDetails(o) {
  const rows = [
    ['Name', esc(o.guestName)],
    o.room ? ['Room', esc(o.room)] : null,
    ['Items', `${o.items} · ${o.loads} load${o.loads > 1 ? 's' : ''}`],
    o.price != null ? ['Total', money(o.price)] : null,
    ['Payment', paymentText(o)],
    ['Placed', when(o.createdAt)],
  ].filter(Boolean);
  return rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

function paymentText(o) {
  if (o.paymentStatus === 'paid') return `Paid, thank you${o.paymentMethod ? ' (' + esc(o.paymentMethod) + ')' : ''}`;
  if (o.paymentStatus === 'partial') return 'Part paid';
  if (o.paymentTiming === 'now') return `Pay at drop-off${o.paymentMethod ? ' · ' + esc(o.paymentMethod) : ''}`;
  return 'Pay at pickup';
}

function renderThread(messages) {
  if (!messages.length) return `<p class="muted" style="margin:0">No messages yet.</p>`;
  return messages.map(m => `<div class="msg ${m.sender === 'guest' ? 'staff' : 'guest'}">
    <div class="who">${m.sender === 'staff' ? esc(m.staffName || 'Reception') : 'You'} · ${when(m.at)}</div>
    ${esc(m.text)}</div>`).join('');
}

async function load() {
  if (!publicId) { $('#notFound').classList.remove('hidden'); return; }
  const res = await fetch(`/api/orders/public/${publicId}`);
  if (!res.ok) { $('#notFound').classList.remove('hidden'); return; }
  order = await res.json();
  $('#content').classList.remove('hidden');
  $('#oNum').textContent = order.number;
  $('#oTitle').textContent = TITLES[order.status] || order.status;
  $('#oLine').textContent = LINES[order.status] || '';
  const ready = $('#oReady');
  if (order.pickupAt && !['completed', 'cancelled'].includes(order.status)) {
    ready.innerHTML = `<div><small>Ready by</small><b style="font-size:17px">${when(order.pickupAt)}</b></div>`;
    ready.classList.remove('hidden');
  } else ready.classList.add('hidden');
  $('#progress').innerHTML = renderProgress(order);
  $('#oDetails').innerHTML = renderDetails(order);
  const thread = $('#thread');
  const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 40;
  thread.innerHTML = renderThread(order.messages || []);
  if (atBottom) thread.scrollTop = thread.scrollHeight;
}

$('#msgForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#msgInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  await fetch(`/api/orders/public/${publicId}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
  });
  await load();
  $('#thread').scrollTop = $('#thread').scrollHeight;
});

loadBranding().then(load);
setInterval(load, 15000); // auto-refresh status + messages
