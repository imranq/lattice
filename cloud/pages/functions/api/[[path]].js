// All API traffic goes to the lattice-api Worker (cloud/api), which routes it
// to the caller's Durable Object.
export const onRequest = ({ request, env }) => env.API.fetch(request);
