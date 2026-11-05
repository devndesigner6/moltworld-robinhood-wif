import { Hono } from "hono";

const serverlessApp = new Hono();
const renderOrigin = "https://motoworld-wif.onrender.com";

serverlessApp.all("*", async (c) => {
  const incoming = new URL(c.req.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, renderOrigin);

  try {
    const upstream = await fetch(new Request(target, c.req.raw));
    const noBody = c.req.method === "HEAD" || upstream.status === 204 || upstream.status === 304;
    const body = noBody ? null : await upstream.arrayBuffer();
    const headers = new Headers(upstream.headers);
    for (const name of ["content-length", "content-encoding", "transfer-encoding", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "upgrade"]) {
      headers.delete(name);
    }
    headers.set("Cache-Control", "no-store");
    return new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (error) {
    console.error("Render proxy failed", error instanceof Error ? error.name : "unknown error");
    return c.json({
      error: {
        code: "render_upstream_unavailable",
        message: "The public gateway is temporarily unavailable.",
      },
    }, 502);
  }
});

export default serverlessApp;
