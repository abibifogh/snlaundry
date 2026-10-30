// Guest order page.
const $ = (s) => document.querySelector(s);
let settings = { piecesPerLoad: 25, currency: { symbol: '' }, pricePerLoad: 0 };

async function loadBranding() {
  try {
    const res = await fetch('/api/public-settings');
    settings = await res.json();
    applyBrand(settings);
  } catch { /* keep defaults */ }
  updateLoadHint();
}

function money(n) { const v = Number(n) || 0; return `${settings.currency?.symbol || ''}${Number.isInteger(v) ? v : v.toFixed(2)}`; }

function applyBrand(s) {
  if (s.accentColor) {
    document.documentElement.style.setProperty('--accent', s.accentColor);
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = s.accentColor;
  }
  const name = s.hostelName || 'Laundry Service';
  $('#brandName').textContent = name;
  document.title = `Place a Laundry Order · ${name}`;
  const mono = $('#brandMono');
  if (s.logoDataUrl) {
    const img = document.createElement('img');
    img.src = s.logoDataUrl; img.alt = name;
    mono.replaceWith(img);
  } else {
    const w = name.trim().split(/\s+/); mono.textContent = ((w[0] || 'L')[0] + (w[1] ? w[1][0] : '')).toLowerCase();
  }
  if (s.pricePerLoad != null && s.currency) {
    const hrs = Number(s.turnaroundHours) || 0;
    $('#priceHint').textContent =
      `${money(s.pricePerLoad)} per load of up to ${s.piecesPerLoad} items${hrs ? `, usually ready within ${hrs} hours` : ''}. Reception confirms the final price when you drop off.`;
  }
  // Email may be optional if the admin turned that off.
  if (s.requireEmail === false) {
    const em = $('#email');
    if (em) { em.required = false; }
    const lbl = document.querySelector('label[for="email"]');
    if (lbl) lbl.innerHTML = 'Email <span class="muted" style="font-weight:400">Optional</span>';
  }
}

// Live estimate: loads and price as the guest counts.
function updateLoadHint() {
  const items = parseInt($('#items').value, 10);
  const per = settings.piecesPerLoad || 25;
  if (items > 0) {
    const loads = Math.max(1, Math.ceil(items / per));
    const room = loads * per - items;
    $('#estAmt').textContent = settings.pricePerLoad != null ? money(loads * settings.pricePerLoad) : '—';
    $('#loadHint').textContent = `${loads} load${loads > 1 ? 's' : ''} · ${room ? `${room} more item${room === 1 ? '' : 's'} fit in this price` : 'that load is full'}`;
  } else {
    $('#estAmt').textContent = '—';
    $('#loadHint').textContent = 'Add your items to see the price';
  }
}
function stepItems(d) {
  const el = $('#items');
  el.value = Math.max(1, (parseInt(el.value, 10) || 0) + d);
  updateLoadHint();
}

function notify(kind, text) {
  $('#msg').innerHTML = `<div class="notice ${kind}"></div>`;
  $('#msg .notice').textContent = text;
}

$('#items').addEventListener('input', updateLoadHint);
$('#itemsDown').addEventListener('click', () => stepItems(-1));
$('#itemsUp').addEventListener('click', () => stepItems(1));

// Show the cash/card choice only when "Pay now" is selected.
document.querySelectorAll('input[name="timing"]').forEach((r) =>
  r.addEventListener('change', () => {
    $('#methodRow').style.display = document.querySelector('input[name="timing"]:checked').value === 'now' ? 'block' : 'none';
  }));

$('#orderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#submitBtn');
  btn.disabled = true; btn.textContent = 'Sending…';
  $('#msg').innerHTML = '';
  const timing = document.querySelector('input[name="timing"]:checked').value;
  const payload = {
    guestName: $('#name').value.trim(),
    guestEmail: $('#email').value.trim(),
    items: parseInt($('#items').value, 10),
    note: $('#note').value.trim(),
    paymentTiming: timing,
    paymentMethod: timing === 'now' ? document.querySelector('input[name="method"]:checked').value : null,
  };
  try {
    const res = await fetch('/api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    $('#formCard').classList.add('hidden');
    $('#doneCard').classList.remove('hidden');
    $('#doneNum').textContent = data.number;
    $('#doneMsg').textContent = `Thanks, ${payload.guestName.split(/\s+/)[0]}. ${payload.guestEmail ? `We’ve sent a copy to ${payload.guestEmail}.` : 'Keep the tracking link below to check on it.'}`;
    $('#donePay').textContent = timing === 'now' ? 'Collect it at reception when it’s ready.' : 'Collect it at reception and pay then.';
    $('#trackLink').href = `/track?id=${data.publicId}`;
    window.scrollTo(0, 0);
  } catch (err) {
    notify('err', err.message);
    btn.disabled = false; btn.textContent = 'Send order';
    window.scrollTo(0, 0);
  }
});

loadBranding();
