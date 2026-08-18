// Accepting a sign-in hand-off from the group hub (Insight).
//
// The dangerous failures here are all failures to refuse: letting a code stand
// in for an identity, creating a cashier because the hub named one, or handing
// somebody a role the hub asked for rather than the one this site holds. Each
// has a test below, and each would be invisible in ordinary use — everything
// would appear to work, for the wrong person.

import { rmSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(os.tmpdir(), 'laundry-sso-'));
process.env.FORCE_FILE_STORE = '1';
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = 'sso-secret';
delete process.env.RESEND_API_KEY;

const SSO = await import('../netlify/functions/lib/sso.js');
const { verifyToken } = await import('../netlify/functions/lib/auth.js');

let pass = 0, fail = 0; const out = [];
const ok = (n, c, x = '') => { if (c) { pass++; out.push(`  ✅ ${n}`); } else { fail++; out.push(`  ❌ ${n} ${x}`); } };
const section = (t) => out.push(`\n▶ ${t}`);

const HUB = 'https://insight.example.com/api/sso/redeem';
const ENV = { INSIGHT_SSO_URL: HUB, INSIGHT_SSO_SECRET: 'shared-with-the-hub' };
const CODE = 'a'.repeat(43);

/** The cashiers this site has. Two with an address, one without. */
const CASHIERS = [
  { id: 'csh_1', name: 'Ama Boateng', email: 'ama@nice.test', role: 'cashier', permissions: { takePayment: true }, active: true },
  { id: 'csh_2', name: 'Kofi Mensah', email: 'kofi@nice.test', role: 'admin', permissions: {}, active: false },
  { id: 'csh_3', name: 'Front desk', email: '', role: 'laundry', permissions: {}, active: true },
];
const list = async () => CASHIERS;

/** A hub that answers with whatever it is told to, and records what it was asked. */
function fakeHub(answer, { status = 200 } = {}) {
  const seen = [];
  const impl = async (url, init) => {
    seen.push({ url, init, body: JSON.parse(init.body) });
    return { ok: status >= 200 && status < 300, status, json: async () => answer };
  };
  impl.seen = seen;
  return impl;
}

const arrive = (code, hub, over = {}) => SSO.handleSsoArrival(code, {
  env: ENV, fetchImpl: hub, list, ...over,
});

try {
  section('A good code');
  {
    const hub = fakeHub({ email: 'ama@nice.test', name: 'Ama Boateng', role: 'owner' });
    const r = await arrive(CODE, hub);

    ok('answers with a page, not a redirect', r.statusCode === 200);
    ok('the page is never cached', /no-store/.test(r.headers['Cache-Control']));
    ok('the address that carried the code goes no further', r.headers['Referrer-Policy'] === 'no-referrer');
    ok('the token is written under the key the app reads', r.body.includes('"laundry_token"'));
    ok('it replaces its own history entry', r.body.includes("location.replace('/app.html')"));
    ok('there is nothing else on the page', !/fetch\(|<form|<input/.test(r.body));

    const token = /setItem\("laundry_token", "([^"]+)"\)/.exec(r.body)?.[1];
    const claims = verifyToken(token);
    ok('the token is one this site signed', Boolean(claims));
    ok('it names the cashier this site holds', claims?.id === 'csh_1');
    ok('the role is this site\'s, not the one the hub asked for', claims?.role === 'cashier');
    ok('it expires', typeof claims?.exp === 'number' && claims.exp > Date.now());
  }

  section('The identity travels on the back channel');
  {
    const hub = fakeHub({ email: 'ama@nice.test', name: 'Ama Boateng', role: 'cashier' });
    await arrive(CODE, hub);
    ok('the code is exchanged, never read', hub.seen.length === 1);
    ok('at the hub\'s own address', hub.seen[0].url === HUB);
    ok('proving what this site is', hub.seen[0].init.headers.Authorization === 'Bearer shared-with-the-hub');
    ok('and saying which system is asking', hub.seen[0].body.systemId === 'laundry');
    ok('with the code and nothing else', hub.seen[0].body.code === CODE
      && Object.keys(hub.seen[0].body).length === 2);
  }

  section('Refusals');
  {
    const hub = fakeHub({ email: 'stranger@nice.test', name: 'A Stranger', role: 'admin' });
    const r = await arrive(CODE, hub);
    ok('somebody with no cashier record is refused', r.statusCode === 400);
    ok('by name, so an admin knows what to add', r.body.includes('stranger@nice.test'));
    ok('no token is handed over', !r.body.includes('laundry_token'));
  }
  {
    const hub = fakeHub({ email: 'kofi@nice.test', name: 'Kofi Mensah', role: 'admin' });
    const r = await arrive(CODE, hub);
    ok('a switched-off account stays switched off', r.statusCode === 400 && /switched off/.test(r.body));
    ok('and gets no token', !r.body.includes('laundry_token'));
  }
  {
    const hub = fakeHub({ error: 'no' }, { status: 400 });
    const r = await arrive(CODE, hub);
    ok('a code the hub refuses is an expired-or-used message', /expired or has already been used/.test(r.body));
  }
  {
    const hub = fakeHub({ error: 'no' }, { status: 401 });
    const r = await arrive(CODE, hub);
    ok('a wrong shared secret says so — it is a setting somebody must fix',
      /did not recognise this site/.test(r.body));
  }
  {
    let called = false;
    const r = await arrive(null, async () => { called = true; });
    ok('a link with no code fails before anything is called', r.statusCode === 400 && !called);
    ok('and says what is missing', /missing its sign-in code/.test(r.body));
  }
  {
    let called = false;
    const r = await SSO.handleSsoArrival(CODE, { env: {}, list, fetchImpl: async () => { called = true; } });
    ok('an unconnected site says so rather than reaching out',
      !called && /not been connected to the group hub/.test(r.body));
  }
  {
    const r = await arrive(CODE, async () => { throw new Error('ECONNREFUSED'); });
    ok('an unreachable hub is a sentence', /could not be reached/.test(r.body));
    ok('not a stack trace', !/ECONNREFUSED/.test(r.body));
  }
  {
    const hub = fakeHub({ name: 'Nobody', role: 'admin' });
    const r = await arrive(CODE, hub);
    ok('a hub that names nobody is refused', /did not say who you are/.test(r.body));
  }
  {
    let called = false;
    const probe = async () => { called = true; };
    await arrive('short', probe);
    await arrive(123, probe);
    ok('an obvious non-code costs no round trip', !called);
  }

  section('Matching an address');
  {
    ok('case and stray spaces do not matter',
      (await SSO.cashierFor('  AMA@Nice.TEST ', { list }))?.id === 'csh_1');
    ok('an empty address matches nobody', (await SSO.cashierFor('', { list })) === null);
    ok('a missing address matches nobody', (await SSO.cashierFor(undefined, { list })) === null);
    // csh_3 has email '' — it must not be reachable by an empty-ish address.
    ok('a PIN-only cashier cannot be handed over',
      (await SSO.cashierFor('   ', { list })) === null);
  }

  section('The pages themselves');
  {
    const hub = fakeHub({ email: '<script>alert(1)</script>@x.test', name: 'x', role: 'admin' });
    const r = await arrive(CODE, hub);
    ok('the failure page escapes what it repeats back',
      !/<script>alert/.test(r.body) && /&lt;script&gt;/.test(r.body));
  }
  {
    // A token containing a quote or a closing tag must not break out of the
    // script it is written into. JSON.stringify is what makes that true.
    const hub = fakeHub({ email: 'ama@nice.test', name: 'Ama', role: 'cashier' });
    const r = await arrive(CODE, hub, { sign: () => '</script><img src=x onerror=alert(1)>' });
    ok('a hostile token cannot break out of the page', !/<\/script><img/.test(r.body));
    ok('it is escaped instead', r.body.includes('\\u003c/script'));
  }

  section('Configuration');
  {
    ok('the system id defaults to the laundry', SSO.ssoConfig(ENV).systemId === 'laundry');
    ok('an unset site is not configured', SSO.ssoConfig({}).configured === false);
    ok('half a setting is not configured',
      SSO.ssoConfig({ INSIGHT_SSO_URL: HUB }).configured === false);
    ok('both settings are configured', SSO.ssoConfig(ENV).configured === true);
  }
} catch (err) {
  fail++;
  out.push(`\n💥 UNCAUGHT: ${err.stack || err}`);
}

console.log(out.join('\n'));
console.log(`\n${'─'.repeat(40)}`);
console.log(`${pass} passed, ${fail} failed`);
rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
