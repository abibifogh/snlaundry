// GET /sso?code=… — the group hub handing somebody over.
//
// A thin shell. Everything worth testing lives in lib/sso.js, which knows
// nothing about Netlify and so can be exercised without it.

import { handleSsoArrival } from './lib/sso.js';

export async function handler(event) {
  return handleSsoArrival(event?.queryStringParameters?.code);
}

export default handler;
