// Give every visitor an anonymous learner id before the page makes any API
// calls. The app fires several requests at once on load; if the id were minted
// by the API instead, each of those would create a different learner.
const COOKIE = 'lattice_uid';

export async function onRequest({ request, next }) {
  if ((request.headers.get('cookie') ?? '').includes(`${COOKIE}=`)) return next();

  const uid = crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set('cookie', [request.headers.get('cookie'), `${COOKIE}=${uid}`].filter(Boolean).join('; '));
  const res = await next(new Request(request, { headers }));
  const out = new Response(res.body, res);
  out.headers.append('set-cookie',
    `${COOKIE}=${uid}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`);
  return out;
}
