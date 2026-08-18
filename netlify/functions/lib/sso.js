// Arriving here already signed in, from the group's hub (Insight).
//
// Somebody who has signed in to Insight can click "Laundry" and land here
// without punching a PIN again. What arrives in the URL is an opaque code —
// never an identity. This module calls Insight back, server to server, with its
// own shared secret, and asks who the code was for.
//
// Three things it deliberately does not do.
//
// It does not trust anything in the URL. A URL ends up in a browser history, a
// proxy log and a `Referer` header, and none of those should ever have held
// somebody's address. The code is thirty-two random bytes that Insight will
// exchange, once, within ninety seconds.
//
// It does not create cashiers. If Insight says "this is ama@example.com" and no
// cashier here uses that address, the answer is no, with a message saying so.
// Auto-provisioning would mean whoever controls the hub can mint themselves a
// till account, and the whole point of a separate grant per system is that
// reaching one is not reaching all of them.
//
// It does not widen anybody. The role Insight sends is ignored. What somebody
// may do here is the role and the permission set on their own cashier record,
// exactly as when they type their PIN.

import { signToken } from './auth.js';
import * as L from './logic.js';

/** The key the reception app reads its token from. Must match public/assets/app.js. */
export const TOKEN_KEY = 'laundry_token';

export function ssoConfig(env = process.env) {
  return {
    redeemUrl: env.INSIGHT_SSO_URL || '',
    secret: env.INSIGHT_SSO_SECRET || '',
    systemId: env.INSIGHT_SSO_SYSTEM || 'laundry',
    configured: Boolean(env.INSIGHT_SSO_URL && env.INSIGHT_SSO_SECRET),
  };
}

/**
 * Swap a code for an identity.
 *
 * Failures are short sentences a person can act on, because whoever hits this
 * followed a link and is now looking at a page wondering what went wrong.
 */
export async function redeemAtHub(code, { env = process.env, timeoutMs = 8000, fetchImpl = fetch } = {}) {
  const config = ssoConfig(env);
  if (!config.configured) throw new Error('This site has not been connected to the group hub yet.');
  // Length only. The code is opaque to us — the hub decides whether it is real
  // — but a two-character "code" is a mistake, not an attempt, and there is no
  // sense spending a round trip on it.
  if (typeof code !== 'string' || code.length < 20 || code.length > 300) {
    throw new Error('That sign-in link is not valid.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(config.redeemUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.secret}` },
      body: JSON.stringify({ systemId: config.systemId, code }),
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('The group hub did not answer in time. Try again.');
    throw new Error('The group hub could not be reached.');
  } finally {
    clearTimeout(timer);
  }

  // A wrong secret is a setting somebody has to fix rather than an attack, so
  // it is worth naming. Every other failure is deliberately the same sentence:
  // telling a caller which kind of bad code they hold tells them something
  // about codes they do not hold.
  if (response.status === 401) {
    throw new Error('The group hub did not recognise this site. Its shared secret is wrong or missing.');
  }
  if (!response.ok) {
    throw new Error('That sign-in link has expired or has already been used. Go back to the hub and click through again.');
  }

  let identity;
  try {
    identity = await response.json();
  } catch {
    throw new Error('The group hub answered with something unreadable.');
  }
  if (!identity?.email) throw new Error('The group hub did not say who you are.');
  return identity;
}

/**
 * Find the cashier Insight named, among this site's own.
 *
 * Matched on email address, the only identifier the two systems share. Most
 * cashiers here have none — they are a PIN at a till — and those simply cannot
 * be handed over, which is right: a PIN is shared knowledge at a counter and a
 * hand-off is one person.
 */
export async function cashierFor(email, { list = L.listCashiers } = {}) {
  const wanted = String(email ?? '').trim().toLowerCase();
  if (!wanted) return null;
  const cashiers = await list();
  return cashiers.find((c) => String(c.email || '').trim().toLowerCase() === wanted) ?? null;
}

/**
 * The whole hand-off, from code to a token in the browser.
 *
 * The reception app keeps its token in `localStorage`, so this cannot set a
 * cookie and be done — it has to land on a page that stores the token, exactly
 * as the PIN pad does. Returns a Netlify function response either way.
 */
export async function handleSsoArrival(code, options = {}) {
  try {
    if (!code) return failure('That link is missing its sign-in code.');

    const identity = await redeemAtHub(code, options);
    const user = await cashierFor(identity.email, options);
    const email = String(identity.email).trim().toLowerCase();

    if (!user) {
      return failure(`The group hub signed you in as ${email}, but no cashier here uses that address. An admin can add it under Cashiers.`);
    }
    if (!user.active) {
      return failure(`The account for ${email} here has been switched off.`);
    }

    // Its own token, with its own claims — the same three the PIN pad signs.
    // The hub's idea of a role never reaches it.
    const token = (options.sign ?? signToken)({ id: user.id, name: user.name, role: user.role });
    return success(token);
  } catch (err) {
    return failure(String(err?.message ?? err));
  }
}

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  // A code is single-use and ninety seconds old, but there is still no reason
  // for the address that carried it to travel anywhere else.
  'Referrer-Policy': 'no-referrer',
};

/**
 * A value safe to drop inside a `<script>` element.
 *
 * `JSON.stringify` is not enough on its own: it happily leaves `</script>`
 * intact, and an HTML parser ends the script at those characters regardless of
 * what JavaScript thinks of them. Nothing signed by this site could contain
 * them — but the one page in this codebase that writes a credential into HTML
 * is not the place to rely on that.
 *
 * U+2028 and U+2029 are escaped too: they are valid inside a JSON string and
 * are line terminators to a JavaScript parser.
 */
function jsString(value) {
  return JSON.stringify(String(value))
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Hand the token over on a page.
 *
 * Writing a credential into HTML is safe here and only here: the page is served
 * once, is never cached, contains nothing else, and replaces its own history
 * entry so the code does not sit in the back button. Do not add anything to it,
 * and do not make it cacheable.
 */
function success(token) {
  return {
    statusCode: 200,
    headers: HEADERS,
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Signing you in…</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f5f7fa;color:#1b2530;margin:0;display:grid;place-items:center;min-height:100vh}p{color:#5a6b7b}
@media (prefers-color-scheme:dark){body{background:#0e1419;color:#e8eef4}p{color:#93a3b3}}</style>
</head><body>
<p>Signing you in…</p>
<script>
  try { localStorage.setItem(${jsString(TOKEN_KEY)}, ${jsString(token)}); } catch (e) {}
  location.replace('/app.html');
</script>
<noscript><p><a href="/app.html">Continue</a></p></noscript>
</body></html>`,
  };
}

function failure(message) {
  const escaped = String(message).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return {
    statusCode: 400,
    headers: HEADERS,
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Could not sign you in</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f5f7fa;color:#1b2530;margin:0;display:grid;place-items:center;min-height:100vh;padding:1.5rem}
  main{background:#fff;border:1px solid rgba(0,0,0,.1);border-radius:10px;padding:1.75rem;max-width:30rem}
  h1{font-size:1.15rem;margin:0 0 .6rem}
  p{margin:0 0 1rem;line-height:1.55;color:#5a6b7b}
  a{color:#1d6fd0}
  @media (prefers-color-scheme:dark){body{background:#0e1419;color:#e8eef4}main{background:#161e26;border-color:rgba(255,255,255,.12)}p{color:#93a3b3}a{color:#63aef5}}
</style></head><body><main>
  <h1>Could not sign you in</h1>
  <p>${escaped}</p>
  <p><a href="/app.html">Sign in with your PIN instead</a></p>
</main></body></html>`,
  };
}
