/**
 * moltworld.xyz is served by a single origin (the VPS: Node gateway + PostgreSQL),
 * so the ledger, receipt key and background workers live in one place. This Worker
 * only exists because a Cloudflare route is bound to the zone: it passes every
 * request straight through to that origin. A subrequest to the same zone from a
 * route-bound Worker goes to the origin, not back into the Worker.
 *
 * To retire it entirely: delete the route in the Cloudflare dashboard (Workers
 * Routes) or run `wrangler delete`.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    return fetch(request);
  },
};
