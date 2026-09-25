// The attendants' guide — the laundry handbook, built into the app.
//
// Everything on the Guide tab is rendered from GUIDE below. To change the
// handbook, edit the text here; no app logic lives in this file. Two bits of
// inline markup are understood: **bold** and [[Button]] — the second draws a
// button-shaped chip, used for anything the attendant actually presses in the app,
// so the words on the page match the words on the screen. *Italics* mark a
// cross-reference to another section.
//
// Loaded before app.js and self-contained: app.js hands renderGuide() the signed-in
// user, and nothing else is shared, so the guide renders the same whatever loads it.

const GUIDE = {
  title: 'Laundry Handbook',
  subtitle: 'Guest laundry, hostel linen and room setup — the practical guide for laundry attendants',
  updated: 'September 2026',

  sections: [
    {
      id: 'job',
      title: 'Your job in one minute',
      intro: 'You look after two streams of laundry. Guest laundry comes in through the app and every piece must go back to the right guest, complete and intact. Hostel linen — sheets, pillowcases, towels — comes from housekeeping and must be washed, dried, folded and arranged ready for rooms.',
      bullets: [
        'Every guest item is **accounted for** from the moment you take the bag until you hand it back to reception.',
        'Clean linen and dirty linen **never** share a surface, a basket or a trolley.',
        'The app is your record. What the guest is told depends on the buttons you press, so press them **when the thing actually happens**.',
        'When in doubt about a setting, a stain or a count — ask before you wash, not after.',
      ],
    },

    {
      id: 'app',
      title: 'The app: signing in and your board',
      steps: [
        'Open the laundry phone or tablet and enter **your own PIN** — 4 to 8 digits. Never use someone else\'s: the app records who did what, and your name goes on every order you touch.',
        'You land on **Orders**. Your board has three columns: **New** (guest has ordered, reception hasn\'t accepted yet — nothing for you to do), **Accepted** (reception has taken the bag — your queue) and **Cleaning** (with you now).',
        'Each card shows the guest\'s name, room, number of items and loads, and the pickup time. That card is what you check the bag against.',
        'Tap a card to open it. The buttons at the bottom are the only ones you need: [[Start cleaning]], [[Mark ready]] and [[🔕 Report a delay]].',
        'When you finish or step away, tap [[🔒 Lock / switch]] so the next person signs in as themselves.',
      ],
      note: 'You will not see a **Ready for pickup** column. That is reception\'s side of the board — once you mark an order ready it moves there and leaves your screen. That is normal, not a mistake.',
    },

    {
      id: 'flow',
      title: 'One guest order, start to finish',
      intro: 'This is the whole job for a single order. Do the steps in this order and the guest gets the right messages at the right moments.',
      steps: [
        '**A card appears in Accepted.** Reception has received the bag. Collect it from reception.',
        '**Check the bag against the card.** Count the items and compare with the number on the card. Look for damage. If the count or the condition doesn\'t match, go back to reception **before** you do anything else — this is the last moment a discrepancy is easy to settle.',
        '**Sort it.** Check colours and separate what needs separating. If the guest asked for items to be washed separately, do that. If they didn\'t, use your own judgement — a red sock in a white wash is your problem, not theirs.',
        '**Treat and soak if needed.** Stains get treated first (see *Stains, soaking and whites*). Whites may soak for several hours. Soaking time counts as working on the order — see the next step.',
        '**Press [[Start cleaning]] when you actually begin** — loading the machine, or putting items to soak. This moves the order to **Cleaning** and sends the guest a message that washing has started. Don\'t press it early to clear the queue, and don\'t forget it: the app starts sending reminders about orders that sit in Accepted for about an hour.',
        '**If you genuinely can\'t start within the hour** — machines full, waiting on a long soak — open the card and press [[🔕 Report a delay]], and type the reason. This quiets the reminder for 30 minutes. If the order still hasn\'t started after that, the reminder comes back. That is the system working, not nagging you.',
        '**Wash using the correct setting** from the *Machine quick guide*. Guest items go in the machine set aside for guest laundry when there is a lot on.',
        '**Dry completely.** Never fold or hand over anything damp.',
        '**Fold neatly and count again.** The count must match the card. This second count is what protects the guest, and you.',
        '**Take the finished laundry to reception** and hand it over.',
        '**Press [[Mark ready]]** — after the handover, not before. The guest is told their laundry is ready for pickup, and the order moves to reception\'s board and off yours. Reception takes payment and marks it picked up; that part is not yours to do.',
      ],
      note: 'A card may show **⏰ pickup soon — check the lines**. That means the guest\'s pickup time is close and the order is still with you. Find it — on the line, in a machine, in a basket — and get it moving first.',
    },

    {
      id: 'limits',
      title: 'When something goes wrong',
      intro: 'A few things are deliberately not in your hands. Knowing who to ask saves time.',
      table: {
        head: ['Situation', 'What to do'],
        rows: [
          ['Pressed [[Start cleaning]] or [[Mark ready]] by mistake', 'You can\'t move an order backwards. Tell reception or the manager — they have a *Move back* button.'],
          ['Count in the bag doesn\'t match the card', 'Go back to reception straight away, before washing. Don\'t "fix" the number yourself.'],
          ['Item is damaged or badly stained when it arrives', 'Show reception before washing so the guest can be told it came in that way.'],
          ['Guest sends a message in the app', 'You can\'t reply. Reception handles guest messages — tell them if it\'s about something on your side.'],
          ['Guest asks you directly about payment or pickup', 'Send them to reception. You don\'t take payment and can\'t mark an order picked up.'],
          ['Order stuck because a machine is broken', 'Press [[🔕 Report a delay]] with the reason, then tell the manager.'],
          ['Something you washed is missing after the handover', 'Tell reception immediately — the app shows who handed over and when, which narrows the search fast.'],
        ],
      },
    },

    {
      id: 'morning',
      title: 'Start of the day',
      intro: 'Before you wash anything, find out what\'s already in progress. Pending guest laundry is rarely all in one place.',
      steps: [
        'Sweep the laundry area and clear dust. Wipe the ironing table. Check the steam iron and top up its water.',
        'Sign in to the app and look at **Accepted** and **Cleaning**. Everything in Cleaning is an order somebody started and didn\'t finish — those come first.',
        'Check the **dry line** for guest laundry that has been washed and is waiting.',
        'Check **inside every machine** for a load that was left behind.',
        'Check with **reception** for finished guest laundry that was handed over but is still waiting for the guest — so you know it\'s done and don\'t go looking for it.',
        'Cross-check what you found against the cards. Every guest item must be somewhere you can point to.',
        'Go to the linen store and count the clean **bedsheets** and **pillowcases** available. This tells you how much hostel linen must be turned round today.',
        'Put products back where they belong. Make sure clean and used linen are separated before the first check-out comes down.',
      ],
    },

    {
      id: 'guest-care',
      title: 'Washing guest laundry',
      bullets: [
        'Guest laundry is promised for the pickup time on the card — normally the next day. Plan the wash, dry and fold around that, not around the end of your shift.',
        'Follow any separation the guest asked for. If nothing was asked, still check colours yourself and separate when you should.',
        'Soak whites when they need it, before washing.',
        'Use the setting in the *Machine quick guide* for the type of item — mixed fabric, sportswear, baby wear, quick wash each have their own.',
        'When there is a lot of guest laundry, two of the five machines can run guest items while the other three take hostel sheets and linen. Don\'t let hostel linen crowd guest orders out.',
        'Don\'t load a machine half-empty for one item unless the pickup time forces it; don\'t overfill one to save a cycle. Both give worse results.',
      ],
    },

    {
      id: 'housekeeping',
      title: 'Housekeeping linen: sort before you wash',
      intro: 'When rooms check out, housekeeping brings used linen down. Sort it as it arrives — the wash setting depends on the category.',
      bullets: ['Bedsheets', 'Body towels', 'Hand towels', 'Floor towels'],
      note: 'Keep the four piles apart all the way to the machine. Floor towels never go in with body towels.',
    },

    {
      id: 'stains',
      title: 'Stains, soaking and keeping whites white',
      intro: 'Check every item for stains before it goes in a machine. Washing a stained item without treating it usually sets the stain.',
      steps: [
        'Separate white linen from coloured items.',
        'Find the stains. Treat what needs treating — don\'t soak everything by habit.',
        'For soaking, use **Power Zone** and follow the time in the *Laundry products* section.',
        'Rust marks on fabric: **RustGo®** only, and only with the supervision the department requires.',
        'After soaking, wash on the correct setting for the item.',
        'Dry completely before folding or storing. Damp linen goes yellow and smells.',
        'Never put clean linen on the floor.',
        'Take badly stained or damaged linen out of room stock and report it to the manager.',
      ],
      note: 'Never mix bleach with any other cleaning product.',
    },

    {
      id: 'linen',
      title: 'Hostel linen: wash → dry → fold → arrange',
      steps: [
        '**Wash** sheets and linen on the setting for bedsheets and towels.',
        '**Dry** completely.',
        '**Fold** clean, dry sheets neatly.',
        '**Arrange** the folded sheets on the laundry trolley so housekeeping can take them straight to rooms.',
        'Iron pillowcases when they need it.',
      ],
      note: 'Linen is finished only when it is clean, dry, neatly folded **and** arranged. Three out of four isn\'t done.',
    },

    {
      id: 'machines',
      title: 'Machine quick guide',
      intro: 'Match the item to the machine and setting. Times are for a full cycle.',
      table: {
        head: ['Machine', 'Items', 'Setting', 'Time'],
        rows: [
          ['LG / White', 'Bedsheets, towels', 'Duvet', '1 hr 33 min'],
          ['LG / White', 'Guest items', 'Mixed Fabric', '1 hr 8 min'],
          ['LG / White', 'Guest sportswear', 'Sports Wear', '52 min'],
          ['LG / White', 'Guest baby wear', 'Baby Care', '3 hr 13 min'],
          ['LG Smart', 'Towels, guest items, mixed fabric', 'Wash & Dry', 'Automatic'],
          ['LG Smart', 'Anything already washed', 'Dry Only', 'Automatic'],
          ['Hisense / Black', 'Bedsheets, towels', 'Mix', '1 hr 58 min'],
          ['Hisense / Black', 'Small load of lightly soiled guest items', 'Quick', '55 min'],
          ['Hisense / Black', 'Guest items', '20 °C', '1 hr 8 min'],
        ],
      },
      note: 'Baby Care is over three hours. Start it early or the pickup time will catch you.',
    },

    {
      id: 'products',
      title: 'Laundry products',
      table: {
        head: ['Product', 'How to use it'],
        rows: [
          ['Washing powder', '1½ tablespoons per wash.'],
          ['Bleach', 'Soak items **separately** for at least 3 hours before they go in the machine — overnight if there is time. Then wash on the correct setting. Never mix with other chemicals.'],
          ['Power Zone', 'For soaking stained items. Follow the soaking time above, then wash as normal.'],
          ['RustGo®', 'Rust stains on fabric **only**, and not for everyday use. Remove just the red cap to expose the tip. Apply straight onto the stain — do not rub it in. Rinse thoroughly. Stubborn marks may need more than one go; rinse thoroughly once the stain is gone. Follow the department\'s supervision procedure before using it.'],
        ],
      },
    },

    {
      id: 'rooms',
      title: 'Room bedding and towels',
      intro: 'What each bed and room takes. "Double method" means one sheet on the bed plus one cover sheet.',
      table: {
        head: ['Room / bed', 'Bedding', 'Pillowcases and towels'],
        rows: [
          ['Dorm — double bed', '1 sheet on the bed + 1 cover sheet', '1 pillowcase. No body, hand or floor towels.'],
          ['Twin room', '1 sheet on the bed + 1 cover sheet, per bed', '2 pillowcases. No body, hand or floor towels.'],
          ['Triple — 1 king + 1 double', 'King: 1 big sheet + 2 double sheets as covers. Double: double method.', 'Double bed: 1 pillowcase. Private-room towel setup.'],
          ['Queen / king bed', '1 big sheet + 2 double sheets as covers', '2 body towels'],
          ['Quadruple — 1 queen + 2 double', 'Queen: 1 big sheet + 2 double sheets as covers. Each double: double method.', '2 hand towels + 1 floor towel. Private-room setup.'],
          ['Big room — 3 double + 1 queen', 'Queen: 1 big sheet + 2 double sheets as covers. Each double: double method.', '2 hand towels + 1 floor towel'],
          ['Single room — king bed', 'As queen/king: 1 big sheet + 2 double sheets as covers', '1 hand towel + 1 floor towel. Body towel as for private rooms.'],
          ['Private double room', 'Double method', 'Body towels + 1 hand towel + 1 floor towel'],
        ],
      },
      note: '**Towel rule.** Dorms get no towels at all. Private rooms get towels. Single and double rooms: 1 hand towel + 1 floor towel. Triple, quadruple and big rooms: 2 hand towels + 1 floor towel.',
    },

    {
      id: 'evening',
      title: 'End of the day',
      steps: [
        'Nothing wet stays in a machine overnight.',
        'Check the dry line, every machine and the ironing area. Anything of a guest\'s that is still out must be somewhere you can name — and its card must still be in **Cleaning**, not marked ready.',
        'Clean linen stored dry and off the floor. Dirty linen separate.',
        'Products back in their places. Iron off and emptied if that is the routine.',
        'Look once more at **Accepted** and **Cleaning** in the app. If an order in Cleaning is finished and handed over, mark it ready now — don\'t leave the guest waiting for a message until tomorrow.',
        'Tap [[🔒 Lock / switch]].',
      ],
    },

    {
      id: 'rules',
      title: 'Golden rules',
      bullets: [
        'Every item is accounted for. Count in, count out.',
        'Clean and dirty never meet.',
        'Nothing wet left in a machine. Nothing damp stored.',
        'Treat stains; don\'t soak everything by habit.',
        'Right machine, right setting, every time.',
        'Press [[Start cleaning]] when you start. Press [[Mark ready]] after the handover. Press [[🔕 Report a delay]] when you\'re stuck.',
        'If it doesn\'t match the card, stop and ask.',
      ],
    },
  ],

  // The daily checklist. Ticks are kept on this device only and reset each day.
  checklist: [
    { group: 'Start of day', items: [
      'Laundry area swept and clean',
      'Ironing table clean; steam iron checked and filled',
      'Accepted and Cleaning columns checked in the app',
      'Dry line checked',
      'Every machine checked for a left-behind load',
      'Reception checked for finished guest laundry',
      'All guest items cross-checked against their cards',
      'Clean bedsheets and pillowcases counted',
    ] },
    { group: 'Guest laundry', items: [
      'Each bag counted against its card before washing',
      'Colours checked and separated',
      'Stains found and treated; soaked only where needed',
      'Correct machine and setting used',
      'Start cleaning pressed when work began',
      'Dried completely, folded, counted again',
      'Handed to reception, then Mark ready pressed',
    ] },
    { group: 'Hostel linen', items: [
      'Used linen sorted into bedsheets / body / hand / floor',
      'Washed on the correct setting',
      'Dried completely, folded, arranged on the trolley',
      'Pillowcases ironed where needed',
    ] },
    { group: 'Before leaving', items: [
      'No wet laundry left in any machine',
      'Dry line, machines and ironing area checked',
      'Clean linen dry, off the floor, apart from dirty',
      'Products back in place',
      'Locked the app',
    ] },
  ],
};

// ---------------------------------------------------------------- Rendering ---

function guideEsc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Escape first, then apply the two markup forms on the escaped text, so nothing in
// the content can inject markup while **bold** and [[Button]] still work.
function guideMarkup(s) {
  return guideEsc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*\n]+?)\*/g, '<i>$1</i>')
    .replace(/\[\[(.+?)\]\]/g, '<kbd class="ui">$1</kbd>');
}

function guideChecklistKey() {
  return 'guide-checklist-' + new Date().toISOString().slice(0, 10);
}
function guideChecklistState() {
  try { return JSON.parse(localStorage.getItem(guideChecklistKey()) || '{}'); } catch { return {}; }
}
function guideChecklistSave(s) {
  try {
    // Yesterday's ticks are no use today — clear them as we go.
    Object.keys(localStorage).filter(k => k.startsWith('guide-checklist-') && k !== guideChecklistKey()).forEach(k => localStorage.removeItem(k));
    localStorage.setItem(guideChecklistKey(), JSON.stringify(s));
  } catch {}
}

function renderGuideSection(sec) {
  const parts = [`<section class="guide-sec" id="g-${sec.id}"><h3>${guideEsc(sec.title)}</h3>`];
  if (sec.intro) parts.push(`<p class="guide-intro">${guideMarkup(sec.intro)}</p>`);
  if (sec.steps) parts.push(`<ol class="guide-steps">${sec.steps.map(s => `<li>${guideMarkup(s)}</li>`).join('')}</ol>`);
  if (sec.bullets) parts.push(`<ul class="guide-bullets">${sec.bullets.map(s => `<li>${guideMarkup(s)}</li>`).join('')}</ul>`);
  if (sec.table) {
    parts.push(`<div class="table-wrap"><table class="data guide-table"><thead><tr>${sec.table.head.map(h => `<th>${guideEsc(h)}</th>`).join('')}</tr></thead><tbody>${
      sec.table.rows.map(r => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="guide-lead"' : ''} data-label="${guideEsc(sec.table.head[i] || '')}">${guideMarkup(c)}</td>`).join('')}</tr>`).join('')
    }</tbody></table></div>`);
  }
  if (sec.note) parts.push(`<p class="guide-note">${guideMarkup(sec.note)}</p>`);
  parts.push('</section>');
  return parts.join('');
}

function renderGuideChecklist() {
  const st = guideChecklistState();
  let idx = 0; let total = 0; let done = 0;
  const groups = GUIDE.checklist.map(g => {
    const items = g.items.map(item => {
      const id = 'ck' + (idx++); total++; if (st[id]) done++;
      return `<label class="guide-check"><input type="checkbox" data-ck="${id}" ${st[id] ? 'checked' : ''} onchange="guideTick(this)"> <span>${guideMarkup(item)}</span></label>`;
    }).join('');
    return `<div class="guide-check-group"><h4>${guideEsc(g.group)}</h4>${items}</div>`;
  }).join('');
  return `<section class="guide-sec" id="g-checklist"><h3>Daily checklist</h3>
    <p class="guide-intro">Tick things off as you go. Ticks stay on this device and clear themselves each morning.</p>
    <p class="guide-progress"><span id="guideProgress">${done} of ${total}</span> done · <button class="small secondary" onclick="guideResetChecklist()">Reset</button></p>
    ${groups}
  </section>`;
}

window.guideTick = (cb) => {
  const st = guideChecklistState();
  if (cb.checked) st[cb.dataset.ck] = 1; else delete st[cb.dataset.ck];
  guideChecklistSave(st);
  const all = document.querySelectorAll('[data-ck]');
  const el = document.getElementById('guideProgress');
  if (el) el.textContent = `${[...all].filter(c => c.checked).length} of ${all.length}`;
};
window.guideResetChecklist = () => {
  guideChecklistSave({});
  document.querySelectorAll('[data-ck]').forEach(c => { c.checked = false; });
  const el = document.getElementById('guideProgress');
  if (el) el.textContent = `0 of ${document.querySelectorAll('[data-ck]').length}`;
};

async function renderGuide(view, user) {
  const forAttendant = user?.role === 'laundry';
  const toc = GUIDE.sections.map(s => `<a href="#g-${s.id}">${guideEsc(s.title)}</a>`).concat('<a href="#g-checklist">Daily checklist</a>').join('');
  view.innerHTML = `
    <div class="guide">
      <div class="guide-head">
        <div>
          <h2>${guideEsc(GUIDE.title)}</h2>
          <p class="hint" style="margin:0">${guideEsc(GUIDE.subtitle)}</p>
        </div>
        <button class="secondary small guide-print" onclick="window.print()">🖨 Print</button>
      </div>
      ${forAttendant ? '' : '<p class="notice info">This is the attendants\' guide. If you\'re on reception, <b>One guest order, start to finish</b> and <b>When something goes wrong</b> show what the laundry side sees and where your handovers fit.</p>'}
      <nav class="guide-toc">${toc}</nav>
      ${GUIDE.sections.map(renderGuideSection).join('')}
      ${renderGuideChecklist()}
      <p class="muted guide-foot">Somewhere Nice · Laundry Department · updated ${guideEsc(GUIDE.updated)}</p>
    </div>`;
}
