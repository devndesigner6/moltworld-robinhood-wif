// Request-flow field, loaded on demand by site.js. Built with TypeGPU: typed buffers, a compute
// pipeline that moves requests through the x402 gate, and a render pipeline that draws them.
export const FLOW_JS = String.raw`
const COMPUTE = (N) => [
  "{",
  "  let i = in.gid.x;",
  "  if (i >= " + N + "u) { return; }",
  "  var p = particles[i];",
  "  let A = params.aspect;",
  "  let gx = params.gate * A;",
  "  let past = step(gx, p.pos.x);",
  "  p.pos.x += p.speed * params.dt * (1.0 + 0.9 * past);",
  "  let t = smoothstep(-A, gx, p.pos.x);",
  "  let lane = (floor(p.seed.y * 4.0) - 1.5) * 0.42;",
  "  let fan = smoothstep(gx, gx + A * 0.55, p.pos.x);",
  "  var goal = p.seed.x * mix(1.0, 0.035, t * t);",
  "  if (p.pos.x > gx) { goal = mix(p.seed.x * 0.035, lane + (fract(p.seed.y * 97.0) - 0.5) * 0.12, fan); }",
  "  goal += sin(params.time * 0.9 + p.seed.y * 60.0 + p.pos.x * 2.5) * 0.018 * (1.0 - t * (1.0 - fan));",
  "  p.pos.y = mix(p.pos.y, goal, min(1.0, params.dt * 5.0));",
  "  let dv = p.pos - params.pointer;",
  "  let dist = length(dv);",
  "  if (params.pointerOn > 0.5 && dist < 0.32) {",
  "    p.vel += normalize(dv + vec2f(0.0001, 0.0)) * (0.32 - dist) * 0.9 * params.dt;",
  "  }",
  "  p.vel *= 0.9;",
  "  p.pos += p.vel;",
  "  if (p.pos.x > A + 0.05) {",
  "    p.pos = vec2f(-A - 0.05 - fract(p.seed.y * 13.7) * 0.4, p.seed.x);",
  "    p.vel = vec2f(0.0, 0.0);",
  "  }",
  "  particles[i] = p;",
  "}",
].join("\n");

const VERTEX = [
  "{",
  "  let p = particlesRO[in.iid];",
  "  var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));",
  "  let c = corners[in.vid];",
  "  let gx = params.gate * params.aspect;",
  "  let lane = u32(floor(p.seed.y * 4.0));",
  "  var col = params.c0;",
  "  if (lane == 1u) { col = params.c1; }",
  "  if (lane == 2u) { col = params.c2; }",
  "  if (lane == 3u) { col = params.c3; }",
  "  let past = smoothstep(gx, gx + 0.08, p.pos.x);",
  "  var tint = mix(params.ink, col, past);",
  "  let flash = 1.0 - smoothstep(0.0, 0.06, abs(p.pos.x - gx));",
  "  tint = mix(tint, params.accent, flash);",
  "  let s = params.scale * p.size * (1.0 + flash * 1.6);",
  "  let world = vec2f(p.pos.x / params.aspect, p.pos.y) + c * s * vec2f(1.0 / params.aspect, 1.0);",
  "  return Out(vec4f(world, 0.0, 1.0), c, vec4f(tint.rgb, tint.a * (0.55 + 0.45 * past)));",
  "}",
].join("\n");

const FRAGMENT = [
  "{",
  "  let r = length(in.uv);",
  "  if (r > 1.0) { discard; }",
  "  let a = in.tint.a * (1.0 - smoothstep(0.55, 1.0, r));",
  "  return vec4f(in.tint.rgb * a, a);",
  "}",
].join("\n");

export async function mount(canvas, opts = {}) {
  if (!navigator.gpu) return null;
  const { tgpu, d } = await import(opts.lib);
  const root = await tgpu.init();
  const rect = canvas.getBoundingClientRect();
  const N = rect.width < 640 ? 3000 : 7000;
  const A0 = rect.width / Math.max(1, rect.height);

  const Particle = d.struct({ pos: d.vec2f, vel: d.vec2f, seed: d.vec2f, speed: d.f32, size: d.f32 });
  const Params = d.struct({
    pointer: d.vec2f, time: d.f32, dt: d.f32, aspect: d.f32, pointerOn: d.f32, scale: d.f32, gate: d.f32,
    ink: d.vec4f, accent: d.vec4f, c0: d.vec4f, c1: d.vec4f, c2: d.vec4f, c3: d.vec4f,
  });

  // Seed positions across the whole band so the first frame already looks like steady state.
  const init = Array.from({ length: N }, () => {
    const y0 = (Math.random() * 2 - 1) * 0.92;
    return { pos: d.vec2f((Math.random() * 2 - 1) * A0, y0), vel: d.vec2f(0, 0), seed: d.vec2f(y0, Math.random()), speed: 0.18 + Math.random() * 0.22, size: 0.5 + Math.random() * 0.9 };
  });
  const store = root.createBuffer(d.arrayOf(Particle, N), init).$usage("storage");
  const particles = store.as("mutable");
  const particlesRO = store.as("readonly");
  const params = root.createUniform(Params);

  const simulate = tgpu.computeFn({ in: { gid: d.builtin.globalInvocationId }, workgroupSize: [64] })(COMPUTE(N)).$uses({ particles, params });
  const vertex = tgpu.vertexFn({
    in: { vid: d.builtin.vertexIndex, iid: d.builtin.instanceIndex },
    out: { pos: d.builtin.position, uv: d.vec2f, tint: d.vec4f },
  })(VERTEX).$uses({ particlesRO, params });
  const fragment = tgpu.fragmentFn({ in: { uv: d.vec2f, tint: d.vec4f }, out: d.vec4f })(FRAGMENT);

  const format = navigator.gpu.getPreferredCanvasFormat();
  const context = root.configureContext({ canvas, alphaMode: "premultiplied" });
  const computePipeline = root.createComputePipeline({ compute: simulate });
  const blend = { srcFactor: "one", dstFactor: "one-minus-src-alpha" };
  const renderPipeline = root.createRenderPipeline({ vertex, fragment, targets: { format, blend: { color: blend, alpha: blend } } });

  let colors = opts.colors();
  const pointer = { x: 0, y: 0, on: 0 };
  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect(), aspect = r.width / r.height;
    pointer.x = ((e.clientX - r.left) / r.width * 2 - 1) * aspect;
    pointer.y = -((e.clientY - r.top) / r.height * 2 - 1);
    pointer.on = 1;
  });
  canvas.addEventListener("pointerleave", () => { pointer.on = 0; });

  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2), r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
  };
  resize();
  new ResizeObserver(resize).observe(canvas);

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const v4 = (c) => d.vec4f(c[0], c[1], c[2], c[3]);
  let last = performance.now(), visible = true, raf = 0;
  const frame = (now) => {
    raf = 0;
    const dt = reduce ? 0 : Math.min(0.05, (now - last) / 1000);
    last = now;
    const r = canvas.getBoundingClientRect();
    params.write({
      pointer: d.vec2f(pointer.x, pointer.y), time: now / 1000, dt, aspect: r.width / Math.max(1, r.height), pointerOn: pointer.on,
      scale: 2.6 / Math.max(1, r.height), gate: opts.gate || 0,
      ink: v4(colors.ink), accent: v4(colors.accent), c0: v4(colors.lanes[0]), c1: v4(colors.lanes[1]), c2: v4(colors.lanes[2]), c3: v4(colors.lanes[3]),
    });
    computePipeline.dispatchWorkgroups(Math.ceil(N / 64));
    renderPipeline.withColorAttachment({ view: context, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }).draw(6, N);
    if (visible) raf = requestAnimationFrame(frame);
  };
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }).observe(canvas);
  raf = requestAnimationFrame(frame);
  return { backend: "WebGPU", setColors(c) { colors = c; } };
}
`;
