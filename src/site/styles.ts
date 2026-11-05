export const SITE_CSS = String.raw`
:root {
  --bg: #0A0A0B; --bg-1: #111113; --bg-2: #17171A; --bg-3: #1E1E22;
  --line: #222226; --line-2: #2F2F35;
  --text: #EDEBE6; --muted: #A3A09A; --dim: #6F6C67;
  --accent: #EDEBE6; --accent-ink: #0A0A0B; --accent-2: #D2CFC8; --accent-soft: #151518;
  --signal: #3DDC97; --mint: var(--signal); --chat: #8AB4FF; --image: #FF8AD8; --voice: #FFC857; --video: #B69CFF; --danger: #FF6B6B;
  --shadow: 0 24px 60px -20px rgba(0, 0, 0, 0.7);
  --font: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --radius: 18px; --radius-s: 12px; --gutter: 20px; --max: 1240px; --header: 68px;
  --ease: cubic-bezier(.2, .8, .2, 1); --ease-out: cubic-bezier(.16, 1, .3, 1);
  color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    --bg: #F4F3EE; --bg-1: #FFFFFF; --bg-2: #ECEAE3; --bg-3: #E3E0D7;
    --line: #DFDCD3; --line-2: #CCC8BD;
    --text: #0E0E10; --muted: #57544E; --dim: #87837B;
    --accent: #0E0E10; --accent-ink: #FFFFFF; --accent-2: #2C2C30; --accent-soft: #ECEAE3;
    --signal: #0E9F66; --mint: var(--signal); --chat: #2E62D9; --image: #C2389B; --voice: #A86F00; --video: #6D4FD8; --danger: #C42B2B;
    --shadow: 0 24px 60px -24px rgba(30, 25, 15, 0.25);
    color-scheme: light;
  }
}
@media (max-width: 600px) { :root { --gutter: 16px; --header: 60px; } }

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font); line-height: 1.55; font-size: 16px; overflow-x: hidden; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
::selection { background: var(--accent); color: var(--accent-ink); }
a { color: var(--text); text-decoration-color: var(--line-2); text-underline-offset: 3px; }
a:hover { text-decoration-color: var(--accent); }
code, pre, .mono { font-family: var(--mono); }
code { font-size: .92em; }
p code, li code, td code, dd code { background: var(--bg-2); border: 1px solid var(--line); padding: 1px 6px; border-radius: 6px; }
img, svg { display: block; }
.wrap { max-width: var(--max); margin: 0 auto; padding: 0 var(--gutter); }
.skip { position: absolute; left: -9999px; } .skip:focus { left: 16px; top: 8px; z-index: 100; background: var(--bg-1); padding: 8px 12px; border-radius: 8px; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 6px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.hidden { display: none !important; }

/* ---------------------------------------------------------------- type */
h1, h2, h3 { font-weight: 600; margin: 0; }
h1 { font-size: clamp(40px, 7.4vw, 100px); line-height: .96; letter-spacing: -0.05em; margin-bottom: 24px; text-wrap: balance; }
.page-hero h1 { font-size: clamp(38px, 6vw, 80px); }
h2 { font-size: clamp(32px, 4.6vw, 60px); line-height: 1; letter-spacing: -0.045em; text-wrap: balance; }
h3 { font-size: 19px; line-height: 1.25; letter-spacing: -0.02em; margin-bottom: 8px; }
h1 em, h2 em, .answer em { font-style: normal; color: var(--muted); }
h1 em, h2 em { display: block; }
.muted { color: var(--muted); }
.note { font-size: 13px; color: var(--muted); }
.err { color: var(--danger); font-size: 14px; }

/* ---------------------------------------------------------------- buttons */
.btn { --bg-b: var(--accent); position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 48px; padding: 12px 22px; border-radius: 999px; border: 1px solid var(--accent); background: var(--accent); color: var(--accent-ink); font: 600 15px/1 var(--font); letter-spacing: -0.01em; text-decoration: none; cursor: pointer; white-space: nowrap; transition: transform .35s var(--ease-out), background-color .2s, border-color .2s, color .2s; will-change: transform; }
.btn .ic { transition: transform .35s var(--ease-out); }
.btn:hover { background: var(--accent-2); border-color: var(--accent-2); }
.btn:hover .ic { transform: translateX(3px); }
.btn:active { transform: scale(.97); }
.btn-ghost { background: transparent; color: var(--text); border-color: var(--line-2); }
.btn-ghost:hover { background: var(--bg-2); border-color: var(--text); }
.btn-small { min-height: 38px; padding: 8px 14px; font-size: 13px; }
.btn-header { min-height: 40px; padding: 9px 16px; font-size: 14px; }
.btn[disabled] { opacity: .6; cursor: progress; }
.link-arrow { display: inline-flex; align-items: center; gap: 6px; color: var(--text); font-weight: 600; font-size: 14px; text-decoration: none; }
.link-arrow .ic { transition: transform .3s var(--ease-out); }
.link-arrow:hover .ic, a:hover > .link-arrow .ic { transform: translateX(4px); }
.cta-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
.cmd { display: inline-flex; align-items: center; gap: 12px; min-height: 48px; padding: 6px 6px 6px 18px; border: 1px dashed var(--line-2); border-radius: 999px; font: 14px var(--mono); color: var(--muted); max-width: 100%; }
.cmd b { color: var(--text); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cmd b::before { content: "$ "; color: var(--dim); }
.icon-btn { display: inline-grid; place-items: center; width: 38px; height: 38px; flex: none; border-radius: 999px; border: 1px solid var(--line); background: var(--bg-1); color: var(--muted); cursor: pointer; transition: color .2s, border-color .2s, transform .2s; }
.icon-btn:hover { color: var(--text); border-color: var(--line-2); }
.icon-btn:active { transform: scale(.92); }

/* ---------------------------------------------------------------- header */
header.site { position: sticky; top: 0; z-index: 50; background: var(--bg); border-bottom: 1px solid transparent; transition: border-color .3s, background-color .3s; }
header.site.scrolled { border-bottom-color: var(--line); background: color-mix(in srgb, var(--bg) 82%, transparent); backdrop-filter: saturate(140%) blur(14px); }
.bar { display: flex; align-items: center; gap: 28px; height: var(--header); }
.brand { display: inline-flex; align-items: center; gap: 10px; color: var(--text); text-decoration: none; flex: none; }
.brand .wm { font-weight: 600; font-size: 19px; letter-spacing: -0.045em; }
.brand .mark { transition: transform .5s var(--ease-out); }
.brand:hover .mark { transform: rotate(-8deg) scale(1.06); }
nav.primary { flex: 1; min-width: 0; }
.nav-list { display: flex; align-items: center; gap: 2px; list-style: none; margin: 0; padding: 0; }
.nav-item { position: relative; }
.nav-trigger, .nav-direct { display: inline-flex; align-items: center; gap: 6px; background: none; border: 0; color: var(--muted); font: 500 14.5px var(--font); letter-spacing: -0.01em; padding: 8px 12px; border-radius: 999px; cursor: pointer; min-height: 40px; text-decoration: none; transition: color .2s, background-color .2s; }
.nav-trigger:hover, .nav-direct:hover, .nav-trigger[aria-expanded="true"] { color: var(--text); background: var(--bg-2); }
.nav-item.active > .nav-trigger, .nav-item.active > .nav-direct { color: var(--text); }
.nav-item.active > .nav-trigger::after, .nav-item.active > .nav-direct::after { content: ""; width: 4px; height: 4px; border-radius: 50%; background: var(--accent); margin-left: 2px; }
.chev { width: 11px; height: 11px; transition: transform .3s var(--ease-out); }
.nav-trigger[aria-expanded="true"] .chev { transform: rotate(180deg); }
.nav-menu { position: absolute; top: calc(100% + 10px); left: -12px; width: max-content; min-width: 420px; max-width: calc(100vw - 32px); background: var(--bg-1); border: 1px solid var(--line); border-radius: 20px; box-shadow: var(--shadow); padding: 10px; transform-origin: 24px 0; animation: menu-in .32s var(--ease-out); }
.nav-menu[hidden] { display: none; }
@keyframes menu-in { from { opacity: 0; transform: translateY(-6px) scale(.98); } }
.nav-cols { display: grid; grid-template-columns: 1fr 1fr; }
.nav-col { padding: 4px; min-width: 0; }
.nav-col + .nav-col { border-left: 1px solid var(--line); }
.nav-col.minor .nav-link { color: var(--muted); font-weight: 400; padding-left: 14px; }
.nav-col.minor .nav-link:hover { color: var(--text); }
.nav-col ul { list-style: none; margin: 0; padding: 0; }
.nav-link { display: flex; gap: 12px; align-items: center; min-height: 44px; padding: 6px 14px 6px 10px; white-space: nowrap; border-radius: 12px; text-decoration: none; color: var(--text); font-size: 14px; font-weight: 500; transition: background-color .15s; }
.nav-link:hover, .nav-link:focus-visible { background: var(--bg-2); }
.nav-ic { display: grid; place-items: center; width: 30px; height: 30px; flex: none; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--muted); transition: color .2s, border-color .2s, transform .3s var(--ease-out); }
.nav-link:hover .nav-ic { color: var(--text); border-color: var(--line-2); transform: rotate(-6deg); }
.header-actions { display: flex; align-items: center; gap: 10px; flex: none; }
.status { display: inline-flex; align-items: center; gap: 8px; font: 500 12.5px var(--mono); color: var(--muted); white-space: nowrap; text-decoration: none; padding: 7px 12px; border: 1px solid var(--line); border-radius: 999px; transition: border-color .2s, color .2s; }
.status:hover { color: var(--text); border-color: var(--line-2); }
.pulse { position: relative; width: 7px; height: 7px; border-radius: 50%; background: var(--mint); flex: none; }
.pulse::after { content: ""; position: absolute; inset: 0; border-radius: 50%; border: 1px solid var(--mint); animation: ping 2s var(--ease-out) infinite; }
.status.down .pulse { background: var(--danger); } .status.down .pulse::after { border-color: var(--danger); }
@keyframes ping { from { transform: scale(1); opacity: .9; } to { transform: scale(3.2); opacity: 0; } }
.menu-btn { display: none; align-items: center; gap: 10px; background: none; border: 1px solid var(--line-2); color: var(--text); border-radius: 999px; min-height: 40px; padding: 8px 14px; font: 500 14px var(--font); cursor: pointer; }
.menu-lines { position: relative; width: 14px; height: 8px; }
.menu-lines::before, .menu-lines::after { content: ""; position: absolute; left: 0; right: 0; height: 1.5px; background: currentColor; border-radius: 2px; transition: transform .3s var(--ease-out), top .3s var(--ease-out); }
.menu-lines::before { top: 0; } .menu-lines::after { top: 6.5px; }
.menu-btn[aria-expanded="true"] .menu-lines::before { top: 3.25px; transform: rotate(45deg); }
.menu-btn[aria-expanded="true"] .menu-lines::after { top: 3.25px; transform: rotate(-45deg); }
.nav-mobile-cta { display: none; }
@media (max-width: 1080px) { .header-actions .status { display: none; } }
@media (max-width: 960px) {
  .menu-btn { display: inline-flex; }
  header.site, header.site.scrolled { backdrop-filter: none; background: var(--bg); }
  .header-actions .btn-header { display: none; }
  .bar { justify-content: space-between; }
  nav.primary { position: fixed; inset: var(--header) 0 0 0; background: var(--bg); border-top: 1px solid var(--line); overflow-y: auto; display: none; padding: 8px var(--gutter) 40px; }
  nav.primary.open { display: block; animation: sheet-in .4s var(--ease-out); }
  @keyframes sheet-in { from { opacity: 0; transform: translateY(-8px); } }
  .nav-list { flex-direction: column; align-items: stretch; gap: 0; }
  .nav-item { border-bottom: 1px solid var(--line); }
  .nav-trigger, .nav-direct { width: 100%; justify-content: space-between; font-size: 22px; font-weight: 600; letter-spacing: -0.03em; padding: 16px 2px; min-height: 60px; color: var(--text); border-radius: 0; }
  .nav-trigger:hover, .nav-direct:hover, .nav-trigger[aria-expanded="true"] { background: none; }
  .chev { width: 14px; height: 14px; }
  .nav-menu { position: static; width: auto; min-width: 0; max-width: none; box-shadow: none; border: 0; padding: 0 0 14px; background: none; animation: none; }
  .nav-cols { grid-template-columns: minmax(0, 1fr); }
  .nav-col { padding: 0; }
  .nav-col + .nav-col { border-left: 0; border-top: 1px solid var(--line); }
  .nav-link, .nav-col.minor .nav-link { padding: 6px 0; white-space: normal; }
  .nav-mobile-cta { display: grid; gap: 10px; margin-top: 24px; }
}

/* ---------------------------------------------------------------- sections and layout */
section.sec { padding: clamp(80px, 11vw, 140px) 0; position: relative; }
section.sec.line { border-top: 1px solid var(--line); }
section.sec.tight { padding: clamp(56px, 7vw, 88px) 0; }
.sec-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px 48px; flex-wrap: wrap; margin-bottom: clamp(40px, 6vw, 72px); }
.sec-head h2 { max-width: 18ch; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.grid-2 > *, .grid-3 > *, .grid-4 > * { min-width: 0; }
@media (max-width: 960px) { .grid-3, .grid-4 { grid-template-columns: repeat(2, 1fr); } .grid-2 { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 600px) { .grid-3, .grid-4 { grid-template-columns: minmax(0, 1fr); } }
.card { background: var(--bg-1); border: 1px solid var(--line); border-radius: var(--radius); padding: 24px; min-width: 0; position: relative; }
.card p { color: var(--muted); margin: 0; font-size: 15px; }
a.card { display: block; text-decoration: none; color: var(--text); transition: border-color .25s, transform .4s var(--ease-out); }
a.card:hover { border-color: var(--line-2); transform: translateY(-3px); }
.card-ic { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); color: var(--accent); margin-bottom: 20px; }
.prose { max-width: 70ch; }
.problem-text { font-size: clamp(18px, 1.8vw, 21px); line-height: 1.5; color: var(--text) !important; margin: 0 0 32px; }
.prose p, .prose li { color: var(--muted); }
.prose h2 { font-size: clamp(26px, 3vw, 36px); margin: 40px 0 14px; }
.prose ol { padding-left: 0; list-style: none; counter-reset: s; display: grid; gap: 14px; }
.prose ol li { counter-increment: s; position: relative; padding-left: 44px; }
.prose ol li::before { content: counter(s, decimal-leading-zero); position: absolute; left: 0; top: 1px; font: 500 13px var(--mono); color: var(--dim); }

/* ---------------------------------------------------------------- reveal */
.js [data-reveal] { opacity: 0; transform: translateY(22px); transition: opacity .9s var(--ease-out), transform .9s var(--ease-out); transition-delay: calc(var(--d, 0) * 80ms); }
.js [data-reveal].in { opacity: 1; transform: none; }
.split .w { display: inline-block; overflow: hidden; vertical-align: top; padding-bottom: .08em; margin-bottom: -.08em; }
.split .w > span { display: inline-block; transform: translateY(105%); transition: transform 1s var(--ease-out); transition-delay: calc(var(--i) * 55ms + 80ms); }
.split.in .w > span { transform: none; }

/* ---------------------------------------------------------------- hero */
.hero { position: relative; padding: clamp(40px, 6vw, 72px) 0 0; overflow: hidden; }
.hero-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 24px; align-items: center; min-height: min(760px, calc(100svh - var(--header))); }
.hero-copy { position: relative; z-index: 2; padding: 24px 0 56px; }
.hero h1 { margin-bottom: 40px; }
.hero h1 { font-size: clamp(40px, 5.6vw, 82px); }
.hero-visual { position: relative; height: min(720px, 72vw); min-height: 420px; overflow: hidden; }
.hero-visual canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: pan-y; cursor: grab; }
.hero-visual canvas:active { cursor: grabbing; }
.world-fallback { position: absolute; inset: 8%; display: grid; place-items: center; transition: opacity .8s; }
.world-fallback svg { width: 100%; height: 100%; max-width: 560px; }
.world-ready .world-fallback { opacity: 0; pointer-events: none; }
.world-chip { position: absolute; z-index: 3; pointer-events: none; display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px; border-radius: 999px; background: var(--bg-1); border: 1px solid var(--line-2); font: 12px var(--mono); color: var(--text); white-space: nowrap; box-shadow: var(--shadow); animation: chip 2.4s var(--ease-out) forwards; }
.world-chip i { width: 6px; height: 6px; border-radius: 50%; background: var(--signal); }
.world-chip b { color: var(--signal); font-weight: 500; }
@keyframes chip { 0% { opacity: 0; transform: translate(-50%, 0) scale(.9); } 12% { opacity: 1; transform: translate(-50%, -16px) scale(1); } 75% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -46px); } }
@media (max-width: 960px) {
  .hero-grid { grid-template-columns: minmax(0, 1fr); min-height: 0; }
  .hero-copy { padding-bottom: 8px; }
  .hero-visual { height: 420px; min-height: 0; margin: 0 calc(var(--gutter) * -1); }
}
@media (max-width: 600px) { .hero-visual { height: 340px; } .cmd { width: 100%; } }

/* ---------------------------------------------------------------- marquee */
.marquee { position: relative; overflow: hidden; display: flex; user-select: none; }
.marquee-track { display: flex; flex: none; gap: var(--gap, 14px); padding-right: var(--gap, 14px); animation: marquee var(--speed, 40s) linear infinite; }
.marquee.reverse .marquee-track { animation-direction: reverse; }
.marquee:hover .marquee-track { animation-play-state: paused; }
@keyframes marquee { to { transform: translateX(-100%); } }
.logo-band { border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.logo-band .marquee { --gap: 0px; --speed: 50s; }
.logo { display: inline-flex; align-items: center; gap: 12px; padding: 30px 36px; color: var(--muted); font-weight: 600; font-size: 19px; letter-spacing: -0.03em; white-space: nowrap; border-right: 1px solid var(--line); transition: color .3s; }
.logo svg { width: 26px; height: 26px; transition: transform .5s var(--ease-out); }
.logo:hover { color: var(--text); }
.logo:hover svg { transform: rotate(-10deg) scale(1.12); }
@media (max-width: 700px) { .logo { padding: 22px 26px; font-size: 16px; } .logo svg { width: 22px; height: 22px; } }

/* ---------------------------------------------------------------- problem */
.problems { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid var(--line); }
.problems li { padding: 28px 32px 28px 0; font-size: clamp(20px, 2.2vw, 26px); font-weight: 600; letter-spacing: -0.03em; line-height: 1.2; min-width: 0; }
.problems li + li { padding-left: 32px; border-left: 1px solid var(--line); }
@media (max-width: 860px) { .problems { grid-template-columns: minmax(0, 1fr); } .problems li, .problems li + li { padding: 22px 0; border-left: 0; border-bottom: 1px solid var(--line); } }
.answer { margin-top: clamp(48px, 7vw, 88px); font-size: clamp(26px, 3.6vw, 46px); line-height: 1.12; letter-spacing: -0.04em; font-weight: 600; max-width: 22ch; }


/* ---------------------------------------------------------------- bento */
.bento { display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px; }
.tile { grid-column: span 6; background: var(--bg-1); border: 1px solid var(--line); border-radius: 24px; padding: 28px; display: flex; flex-direction: column; min-width: 0; overflow: hidden; position: relative; text-decoration: none; color: var(--text); transition: border-color .3s, transform .5s var(--ease-out); }
.tile:hover { border-color: var(--line-2); }
.tile.wide { grid-column: span 7; } .tile.narrow { grid-column: span 5; }
.tile-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.tile h3 { font-size: clamp(24px, 2.6vw, 32px); letter-spacing: -0.04em; line-height: 1.1; margin: 0; }
.tile-visual { margin-top: auto; padding-top: 28px; min-width: 0; }
.go { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 50%; border: 1px solid var(--line-2); color: var(--muted); transition: background-color .3s, color .3s, transform .5s var(--ease-out); flex: none; }
.tile:hover .go, .link-card:hover .go, .uc:hover .go { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); transform: rotate(-45deg); }
@media (max-width: 960px) { .tile, .tile.wide, .tile.narrow { grid-column: 1 / -1; } }

/* terminal */
.term { background: var(--bg); border: 1px solid var(--line); border-radius: 14px; font: 12.5px/1.7 var(--mono); overflow: hidden; }
.term-bar { display: flex; align-items: center; gap: 6px; padding: 10px 14px; border-bottom: 1px solid var(--line); color: var(--dim); font-size: 11.5px; }
.term-bar i { width: 9px; height: 9px; border-radius: 50%; border: 1px solid var(--line-2); }
.term-bar span { margin-left: 8px; }
.term-body { padding: 14px 16px; min-height: 196px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--muted); }
.term-body .l { display: block; opacity: 0; transform: translateY(4px); transition: opacity .35s, transform .35s var(--ease-out); }
.term-body .l.on { opacity: 1; transform: none; }
.t-cmd { color: var(--text); } .t-cmd::before { content: "$ "; color: var(--dim); }
.t-402 { color: var(--voice); } .t-ok { color: var(--mint); } .t-dim { color: var(--dim); } .t-acc { color: var(--accent); }
.caret { display: inline-block; width: 7px; height: 14px; background: var(--signal); vertical-align: -2px; animation: blink 1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }

/* mandate meter */
.meter { background: var(--bg); border: 1px solid var(--line); border-radius: 14px; padding: 18px; }
.meter-top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font: 12.5px var(--mono); color: var(--muted); }
.meter-top b { font: 600 28px var(--mono); color: var(--text); letter-spacing: -0.04em; }
.meter-bar { height: 10px; border-radius: 99px; background: var(--bg-3); margin: 14px 0; overflow: hidden; display: flex; gap: 2px; }
.meter-bar i { flex: 1; background: var(--bg-3); border-radius: 2px; transition: background-color .25s; }
.meter-bar i.on { background: var(--accent); }
.meter-bar i.cap { background: var(--danger); }
.limits { display: flex; flex-wrap: wrap; gap: 6px; }
.limit { font: 12px var(--mono); padding: 4px 9px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
.limit b { color: var(--text); font-weight: 500; }
.meter-actions { display: flex; align-items: center; gap: 10px; margin-top: 14px; font: 12px var(--mono); color: var(--dim); }
.switch { position: relative; width: 44px; height: 26px; border-radius: 99px; border: 1px solid var(--line-2); background: var(--bg-2); cursor: pointer; flex: none; padding: 0; min-height: 36px; min-width: 52px; display: inline-flex; align-items: center; }
.switch::after { content: ""; position: absolute; left: 5px; width: 18px; height: 18px; border-radius: 50%; background: var(--mint); transition: transform .35s var(--ease-out), background-color .2s; }
.switch[aria-checked="false"]::after { transform: translateX(20px); background: var(--danger); }

/* split ring */
.split-wrap { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
.split-ring { width: 150px; height: 150px; flex: none; }
.split-ring circle { fill: none; stroke-width: 14; }
.split-ring .bg { stroke: var(--bg-3); }
.split-ring .fg { stroke: var(--accent); stroke-dasharray: 0 400; transition: stroke-dasharray 1.6s var(--ease-out); transform: rotate(-90deg); transform-origin: 50% 50%; }
.in .split-ring .fg { stroke-dasharray: var(--dash) 400; }
.split-ring text { fill: var(--text); font: 600 26px var(--mono); }
.split-legend { display: grid; gap: 8px; font: 13px var(--mono); color: var(--muted); }
.split-legend span { display: flex; align-items: center; gap: 8px; }
.split-legend i { width: 10px; height: 10px; border-radius: 3px; background: var(--accent); }
.split-legend i.o { background: var(--bg-3); }

/* receipt mini */
.rcpt { background: var(--bg); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; font: 12.5px/1.8 var(--mono); position: relative; }
.rcpt-row { display: flex; justify-content: space-between; gap: 16px; border-bottom: 1px dashed var(--line); }
.rcpt-row:last-of-type { border-bottom: 0; }
.rcpt-row span:first-child { color: var(--dim); flex: none; }
.rcpt-row span:last-child { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.stamp { position: absolute; right: 18px; top: -14px; display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border: 1.5px solid var(--mint); color: var(--mint); border-radius: 8px; font: 600 12px var(--mono); text-transform: uppercase; letter-spacing: .1em; transform: rotate(-8deg) scale(1.6); opacity: 0; transition: transform .5s var(--ease-out), opacity .3s; background: var(--bg); }
.rcpt.verified .stamp { transform: rotate(-8deg) scale(1); opacity: 1; }

/* ---------------------------------------------------------------- flow band */
.flow { position: relative; border: 1px solid var(--line); border-radius: 28px; background: var(--bg-1); height: clamp(320px, 38vw, 440px); overflow: hidden; }
.flow canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.flow-fallback { position: absolute; inset: 0; width: 100%; height: 100%; }
.flow-ready .flow-fallback { display: none; }
.flow-fallback path { fill: none; stroke-width: 1.4; stroke-dasharray: 2 12; stroke-linecap: round; vector-effect: non-scaling-stroke; animation: dash 1.4s linear infinite; }
.flow-fallback .in { stroke: var(--muted); } .flow-fallback .o0 { stroke: var(--video); } .flow-fallback .o1 { stroke: var(--voice); } .flow-fallback .o2 { stroke: var(--image); } .flow-fallback .o3 { stroke: var(--chat); }
@keyframes dash { to { stroke-dashoffset: -28; } }
.flow-label { position: absolute; font: 500 12px var(--mono); text-transform: uppercase; letter-spacing: .1em; color: var(--muted); background: var(--bg-1); padding: 6px 10px; border: 1px solid var(--line); border-radius: 999px; white-space: nowrap; }
.flow-label.l { left: 18px; top: 18px; }
.flow-label.c { left: 50%; bottom: 18px; transform: translateX(-50%); color: var(--signal); border-color: color-mix(in srgb, var(--signal) 40%, transparent); }
.flow-label.r { right: 18px; top: 18px; }
.flow-gate { position: absolute; left: 50%; top: 18%; bottom: 18%; width: 1px; background: var(--line-2); }
.flow-lanes { position: absolute; inset: 0; pointer-events: none; font: 12px var(--mono); }
.flow-lanes span { position: absolute; right: 18px; transform: translateY(-160%); display: inline-flex; align-items: center; gap: 8px; justify-content: flex-end; color: var(--muted); background: var(--bg-1); padding: 3px 8px; border-radius: 99px; }
.flow-lanes i { width: 8px; height: 8px; border-radius: 50%; }
.flow-tag { position: absolute; right: 18px; bottom: 18px; font: 11px var(--mono); color: var(--dim); }
@media (max-width: 600px) { .flow-lanes, .flow-tag { display: none; } .flow-label.r { display: none; } }

/* ---------------------------------------------------------------- steps */
.steps { list-style: none; padding: 0; margin: 48px 0 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; counter-reset: step; position: relative; }
.steps::before { content: ""; position: absolute; left: 0; right: 0; top: 15px; height: 1px; background: var(--line); }
.steps::after { content: ""; position: absolute; left: 0; top: 15px; height: 1px; width: 100%; background: var(--accent); transform: scaleX(0); transform-origin: left; transition: transform 2.2s var(--ease-out) .2s; }
.steps.in::after { transform: scaleX(1); }
.steps li { counter-increment: step; padding: 0 24px 0 0; position: relative; min-width: 0; }
.steps li::before { content: counter(step, decimal-leading-zero); position: relative; z-index: 1; display: inline-grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--bg); border: 1px solid var(--line-2); color: var(--accent); font: 500 12px var(--mono); margin-bottom: 22px; transition: background-color .4s, color .4s, border-color .4s; transition-delay: calc(var(--d, 0) * 450ms + 300ms); }
.steps.in li::before { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.steps strong { display: block; font-size: 18px; letter-spacing: -0.02em; line-height: 1.35; font-weight: 600; max-width: 22ch; }
@media (max-width: 960px) { .steps { grid-template-columns: 1fr 1fr; gap: 36px 0; } .steps::before, .steps::after { display: none; } }
@media (max-width: 560px) { .steps { grid-template-columns: minmax(0, 1fr); } }

/* ---------------------------------------------------------------- models showcase */
.mod-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 40px; }
.mod { display: block; border: 1px solid var(--line); border-radius: 20px; padding: 22px; background: var(--bg-1); position: relative; overflow: hidden; color: var(--text); text-decoration: none; transition: border-color .25s, transform .4s var(--ease-out); }
.mod:hover { border-color: var(--c); transform: translateY(-3px); }
.mod .k { display: flex; align-items: center; gap: 8px; font: 500 12px var(--mono); text-transform: uppercase; letter-spacing: .1em; color: var(--muted); }
.mod .k i { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
.mod .v { font: 600 clamp(44px, 5vw, 64px)/1 var(--font); letter-spacing: -0.05em; margin: 18px 0 6px; }
.mod .bars { position: absolute; right: 18px; top: 22px; display: flex; gap: 3px; align-items: flex-end; height: 26px; }
.mod .bars b { width: 3px; background: var(--c); border-radius: 2px; animation: eq 1.2s ease-in-out infinite alternate; animation-delay: calc(var(--j) * -0.22s); }
@keyframes eq { from { height: 20%; } to { height: 100%; } }
@media (max-width: 860px) { .mod-row { grid-template-columns: 1fr 1fr; } }
.rails-band { margin-top: calc(clamp(80px, 11vw, 140px) * -1 + 8px); padding-bottom: clamp(80px, 11vw, 140px); }
.model-rails { display: grid; gap: 14px; }
.model-rails .marquee { --speed: 70s; }
.mpill { display: inline-flex; align-items: center; gap: 12px; padding: 12px 18px 12px 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg-1); white-space: nowrap; text-decoration: none; color: var(--text); transition: border-color .25s, transform .4s var(--ease-out); }
.mpill:hover { border-color: var(--line-2); transform: translateY(-2px); }
.mpill .lg { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--bg-2); color: var(--text); flex: none; }
.mpill .lg svg { width: 18px; height: 18px; }
.mpill .nm { font-weight: 600; font-size: 15px; letter-spacing: -0.02em; }
.mpill .pr { font: 12px var(--mono); color: var(--muted); }
.mpill .md { width: 7px; height: 7px; border-radius: 50%; background: var(--c); }
.dot-chat { --c: var(--chat); } .dot-image { --c: var(--image); } .dot-voice { --c: var(--voice); } .dot-video { --c: var(--video); }

/* ---------------------------------------------------------------- agent demo */
.agent-grid { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: clamp(32px, 6vw, 80px); align-items: center; }
@media (max-width: 960px) { .agent-grid { grid-template-columns: minmax(0, 1fr); } }
.feature-list { list-style: none; padding: 0; margin: 0 0 32px; display: grid; gap: 4px; }
.feature-list li { display: flex; align-items: center; gap: 14px; padding: 18px 0; border-bottom: 1px solid var(--line); }
.feature-list li:first-child { border-top: 1px solid var(--line); }
.feature-list .ic { flex: none; }
.feature-list b { font-weight: 600; font-size: 17px; letter-spacing: -0.02em; }
.agent-grid h2, .dev-grid h2 { margin-bottom: 32px; }
.chat { background: var(--bg-1); border: 1px solid var(--line); border-radius: 24px; padding: 18px; display: grid; gap: 12px; min-height: 470px; align-content: start; }
.chat-head { font: 12px var(--mono); color: var(--dim); padding: 0 4px 10px; border-bottom: 1px solid var(--line); }
.msg { max-width: 88%; padding: 12px 16px; border-radius: 18px; font-size: 14.5px; opacity: 0; transform: translateY(8px); transition: opacity .4s, transform .5s var(--ease-out); }
.msg.on { opacity: 1; transform: none; }
.msg.user { justify-self: end; background: var(--text); color: var(--bg); border-bottom-right-radius: 6px; }
.msg.bot { background: var(--bg-2); border-bottom-left-radius: 6px; }
.tool { font: 12.5px/1.6 var(--mono); border: 1px solid var(--line); border-radius: 14px; padding: 10px 14px; background: var(--bg); color: var(--muted); opacity: 0; transform: translateY(8px); transition: opacity .4s, transform .5s var(--ease-out); overflow-wrap: anywhere; }
.tool.on { opacity: 1; transform: none; }
.tool .fn { color: var(--text); font-weight: 500; }
.tool .ok { color: var(--mint); }
.typing { display: inline-flex; gap: 4px; padding: 14px 16px; background: var(--bg-2); border-radius: 18px; width: fit-content; }
.typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--dim); animation: bounce 1s infinite; }
.typing i:nth-child(2) { animation-delay: .15s; } .typing i:nth-child(3) { animation-delay: .3s; }
@keyframes bounce { 50% { transform: translateY(-4px); opacity: .5; } }

/* ---------------------------------------------------------------- code */
.code-card { background: var(--bg-1); border: 1px solid var(--line); border-radius: 20px; overflow: hidden; min-width: 0; }
.code-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 8px 8px 10px; border-bottom: 1px solid var(--line); }
.code-card [role="tablist"] { display: flex; flex-wrap: wrap; gap: 2px; min-width: 0; }
.code-card [role="tab"] { background: none; color: var(--muted); border: 0; border-radius: 999px; padding: 8px 14px; font: 500 13.5px var(--font); cursor: pointer; min-height: 38px; white-space: nowrap; transition: color .2s, background-color .2s; }
.code-card [role="tab"]:hover { color: var(--text); }
.code-card [role="tab"][aria-selected="true"] { color: var(--text); background: var(--bg-3); }
.code-card pre { margin: 0; border: 0; border-radius: 0; background: none; }
pre.code, .code-card pre { padding: 20px; overflow-x: auto; font-size: 13px; line-height: 1.7; max-width: 100%; }
pre.code { background: var(--bg-1); border: 1px solid var(--line); border-radius: 16px; margin: 0; }
.tk-c { color: var(--dim); } .tk-s { color: var(--signal); } .tk-k { color: var(--muted); } .tk-n { color: var(--text); } .tk-f { color: var(--text); font-weight: 500; }
[role="tabpanel"] { animation: fade .35s var(--ease-out); }
@keyframes fade { from { opacity: 0; } }
.dev-grid { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: clamp(32px, 6vw, 72px); align-items: start; }
@media (max-width: 960px) { .dev-grid { grid-template-columns: minmax(0, 1fr); } }
.sdk-list { display: grid; gap: 10px; margin-top: 8px; }
.sdk { display: flex; align-items: center; gap: 14px; min-height: 56px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 14px; text-decoration: none; color: var(--text); transition: border-color .2s, transform .4s var(--ease-out); }
.sdk:hover { border-color: var(--line-2); transform: translateX(4px); }
.sdk .ic { flex: none; }
.sdk b { font-weight: 600; font-size: 15px; }
.sdk .ic:last-child { margin-left: auto; color: var(--dim); }

/* ---------------------------------------------------------------- compare */
.compare { border: 1px solid var(--line); border-radius: 24px; overflow: hidden; background: var(--bg-1); }
.compare-row { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr); border-top: 1px solid var(--line); }
.compare-row:first-child { border-top: 0; }
.compare-row > div { padding: 18px 22px; display: flex; align-items: center; gap: 10px; font-size: 15px; min-width: 0; }
.compare-row > div:first-child { color: var(--text); font-weight: 500; }
.compare-row > div + div { border-left: 1px solid var(--line); color: var(--muted); }
.compare-row .us { background: var(--accent-soft); color: var(--text) !important; }
.compare-row.head > div { font: 500 12px var(--mono); text-transform: uppercase; letter-spacing: .1em; color: var(--dim); }
.compare-row.head .us { color: var(--accent) !important; }
.compare .ic { flex: none; }
.compare .us .ic { color: var(--signal); }
@media (max-width: 700px) { .compare-row { grid-template-columns: 1fr 1fr; } .compare-row > div:first-child { grid-column: 1 / -1; border-bottom: 1px solid var(--line); padding-bottom: 12px; } .compare-row > div:nth-child(2) { border-left: 0; } .compare-row.head > div:first-child { display: none; } }

/* ---------------------------------------------------------------- stats */
.stat-row { display: grid; grid-template-columns: repeat(4, 1fr); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.stat-row > div { padding: 32px 24px 32px 0; min-width: 0; }
.stat-row > div + div { padding-left: 24px; border-left: 1px solid var(--line); }
.stat-row .v { font: 600 clamp(28px, 3.6vw, 52px)/1 var(--font); letter-spacing: -0.05em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.stat-row .k { font: 12.5px var(--mono); color: var(--muted); margin-top: 12px; text-transform: uppercase; letter-spacing: .08em; }
[hidden] { display: none !important; }
.stat-row-3 { grid-template-columns: repeat(3, 1fr); }
.stat-row-sm { border-top: 0; }
.stat-row-sm .v { font-size: clamp(24px, 2.8vw, 38px); letter-spacing: -0.04em; }
.share { display: inline-block; height: 6px; width: 72px; border-radius: 3px; background: var(--bg-2); vertical-align: middle; margin-right: 10px; overflow: hidden; }
.share i { display: block; height: 100%; background: var(--signal); }
@media (max-width: 760px) { .stat-row, .stat-row-3 { grid-template-columns: 1fr 1fr; } .stat-row-3 > div:nth-child(3) { grid-column: 1 / -1; } .stat-row > div:nth-child(3) { padding-left: 0; border-left: 0; } .stat-row > div:nth-child(n+3) { border-top: 1px solid var(--line); } }

/* ---------------------------------------------------------------- use-case rail */
.rail { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(280px, 1fr); gap: 16px; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 16px; scrollbar-width: thin; }
.rail > * { scroll-snap-align: start; }
.uc { display: flex; flex-direction: column; justify-content: space-between; gap: 32px; min-height: 240px; padding: 26px; border: 1px solid var(--line); border-radius: 24px; background: var(--bg-1); text-decoration: none; color: var(--text); transition: border-color .3s, background-color .3s; }
.uc:hover { border-color: var(--line-2); }
.uc h3 { font-size: 24px; letter-spacing: -0.035em; margin: 0; }
.uc .go { align-self: flex-end; }
.uc-ic { color: var(--text); }
.uc-examples { font: 13px var(--mono); color: var(--muted); margin-top: -18px; }
.lab-stack { display: flex; gap: 8px; margin: 22px 0 4px; min-height: 40px; align-items: center; }
.lab-stack span { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; background: var(--bg-2); color: var(--text); transition: transform .4s var(--ease-out); }
.lab-stack svg { width: 20px; height: 20px; }
.mod:hover .lab-stack span { transform: translateY(-3px); }
.mod:hover .lab-stack span:nth-child(2) { transition-delay: 40ms; } .mod:hover .lab-stack span:nth-child(3) { transition-delay: 80ms; } .mod:hover .lab-stack span:nth-child(4) { transition-delay: 120ms; }
.example-list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 10px; }
.example-list li { padding: 12px 18px; border: 1px solid var(--line-2); border-radius: 999px; font-size: 17px; font-weight: 600; letter-spacing: -0.02em; background: var(--bg-1); }
.pays { display: inline-flex; align-items: center; gap: 8px; }
.pays::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--dim); flex: none; }
.pays-mandate::before, .pays-earns::before { background: var(--signal); }
.pays-wallet::before { background: var(--text); }
.uc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); gap: 16px; }
@media (max-width: 760px) { .rail { grid-auto-columns: 82%; } }

/* ---------------------------------------------------------------- faq */
.faq { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: clamp(32px, 6vw, 80px); align-items: start; }
@media (max-width: 860px) { .faq { grid-template-columns: minmax(0, 1fr); } }
details.qa { border-top: 1px solid var(--line); }
details.qa:last-child { border-bottom: 1px solid var(--line); }
details.qa summary { list-style: none; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 22px 0; font-size: 18px; font-weight: 600; letter-spacing: -0.02em; }
details.qa summary::-webkit-details-marker { display: none; }
details.qa summary::after { content: "+"; font: 400 26px/1 var(--font); color: var(--muted); transition: transform .35s var(--ease-out); flex: none; }
details.qa[open] summary::after { transform: rotate(45deg); color: var(--accent); }
details.qa .ans { color: var(--muted); padding: 0 0 24px; max-width: 64ch; animation: fade .4s var(--ease-out); }
details.qa .ans p { margin: 0; }

/* ---------------------------------------------------------------- cta */
.cta-final { position: relative; text-align: center; padding: clamp(96px, 14vw, 180px) 0; border-top: 1px solid var(--line); overflow: hidden; }
.cta-final h2 { font-size: clamp(40px, 7.6vw, 108px); max-width: 14ch; margin: 0 auto 24px; }
.cta-final h2 { margin-bottom: 40px; }
.cta-final .cta-row { justify-content: center; }
.orbit-deco { position: absolute; left: 50%; top: 50%; width: min(1100px, 140vw); aspect-ratio: 1; transform: translate(-50%, -50%); pointer-events: none; }
.orbit-deco i { position: absolute; inset: 0; border: 1px solid var(--line); border-radius: 50%; animation: spin 60s linear infinite; }
.orbit-deco i:nth-child(2) { inset: 16%; animation-duration: 45s; animation-direction: reverse; }
.orbit-deco i:nth-child(3) { inset: 32%; animation-duration: 30s; }
.orbit-deco i::after { content: ""; position: absolute; top: 50%; left: -6px; width: 11px; height: 11px; border-radius: 50%; background: var(--signal); }
.orbit-deco i:nth-child(2)::after { background: var(--mint); left: auto; right: -6px; }
.orbit-deco i:nth-child(3)::after { background: var(--text); top: -6px; left: 50%; }
@keyframes spin { to { transform: rotate(360deg); } }
.cta-final .wrap { position: relative; }

/* ---------------------------------------------------------------- page hero */
.page-hero { position: relative; padding: clamp(56px, 8vw, 104px) 0 clamp(48px, 6vw, 80px); border-bottom: 1px solid var(--line); overflow: hidden; }
.page-hero-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, .85fr); gap: 48px; align-items: center; }
.page-hero-grid.solo { grid-template-columns: minmax(0, 1fr); }
.page-hero h1 { margin-bottom: 36px; }
.page-hero-grid.solo h1 { max-width: 18ch; }
.page-hero-visual { min-width: 0; }
@media (max-width: 960px) { .page-hero-grid { grid-template-columns: minmax(0, 1fr); } }
.crumbs { display: flex; gap: 8px; align-items: center; font: 12.5px var(--mono); color: var(--dim); margin: -8px 0 16px; flex-wrap: wrap; }
.crumbs a { display: inline-flex; align-items: center; min-height: 36px; color: var(--muted); text-decoration: none; } .crumbs a:hover { color: var(--text); }

/* facts: one standalone sentence each */
.facts { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid var(--line); border-left: 1px solid var(--line); }
.facts li { display: flex; flex-direction: column; gap: 22px; padding: 28px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); font-size: 17px; font-weight: 500; letter-spacing: -0.015em; line-height: 1.4; min-width: 0; transition: background-color .3s; }
.facts li:hover { background: var(--bg-1); }
.facts .ic { transition: transform .5s var(--ease-out); }
.facts li:hover .ic { transform: scale(1.15) rotate(-6deg); }
.grid-2 > .facts { grid-template-columns: minmax(0, 1fr); align-self: start; }
@media (max-width: 960px) { .facts { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) { .facts { grid-template-columns: minmax(0, 1fr); } }
.link-card { display: flex !important; flex-direction: column; justify-content: space-between; gap: 24px; min-height: 180px; }
.link-card h3 { font-size: 20px; margin: 0; }
.link-card .go { align-self: flex-end; }

/* product rows */
.prow { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: clamp(32px, 6vw, 80px); align-items: center; padding: clamp(48px, 7vw, 88px) 0; border-top: 1px solid var(--line); }
.prow:nth-child(even) .prow-visual { order: -1; }
.prow h2 { font-size: clamp(30px, 3.8vw, 48px); margin-bottom: 24px; }
@media (max-width: 960px) { .prow { grid-template-columns: minmax(0, 1fr); } .prow:nth-child(even) .prow-visual { order: 0; } }

/* tables, lists */
.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 20px; background: var(--bg-1); }
table { width: 100%; border-collapse: collapse; font-size: 14.5px; }
th, td { text-align: left; padding: 15px 18px; border-bottom: 1px solid var(--line); vertical-align: top; }
tr:last-child td { border-bottom: 0; }
th { color: var(--dim); font: 500 11.5px var(--mono); text-transform: uppercase; letter-spacing: .1em; white-space: nowrap; }
tbody tr { transition: background-color .2s; }
tbody tr:hover { background: var(--bg-2); }
td.mono a { color: var(--accent); }
@media (max-width: 640px) {
  table.stack thead { display: none; }
  table.stack tr { display: block; padding: 12px 16px; border-bottom: 1px solid var(--line); }
  table.stack td { display: flex; justify-content: space-between; gap: 12px; border: 0; padding: 4px 0; overflow-wrap: anywhere; }
  table.stack td::before { content: attr(data-label); color: var(--dim); font: 12px var(--mono); flex: none; }
}
ul.checks { list-style: none; padding: 0; margin: 0; display: grid; gap: 0; }
ul.checks li { padding: 16px 0 16px 34px; position: relative; color: var(--muted); border-bottom: 1px solid var(--line); }
ul.checks li:first-child { border-top: 1px solid var(--line); }
ul.checks li::before { content: ""; position: absolute; left: 4px; top: 22px; width: 12px; height: 7px; border-left: 2px solid var(--accent); border-bottom: 2px solid var(--accent); transform: rotate(-45deg); }
ul.checks li strong { color: var(--text); }
.split-table { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 760px) { .split-table { grid-template-columns: minmax(0, 1fr); } }
.enforce { border: 1px solid var(--line); border-radius: 24px; padding: 26px; background: var(--bg-1); }
.enforce h3 { display: flex; align-items: center; gap: 10px; }
.enforce ul { list-style: none; margin: 0; padding: 0; }
.enforce h3 { margin-bottom: 18px; }
.enforce li { padding: 12px 0; border-top: 1px solid var(--line); font-size: 15px; }

/* pricing */
.formula { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 12px 18px; padding: clamp(28px, 5vw, 56px); border: 1px solid var(--line); border-radius: 28px; background: var(--bg-1); font: 600 clamp(22px, 3.4vw, 44px)/1.1 var(--font); letter-spacing: -0.04em; text-align: center; }
.formula .term-box { padding: 12px 20px; border: 1px solid var(--line-2); border-radius: 16px; background: var(--bg); }
.formula .op { color: var(--dim); font-weight: 400; }
.free-list { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.free { padding: 24px; border: 1px solid var(--line); border-radius: 20px; }
.free b { display: block; font: 600 34px var(--font); letter-spacing: -0.05em; }
.free span { color: var(--muted); font-size: 14.5px; }
@media (max-width: 860px) { .free-list { grid-template-columns: 1fr 1fr; } }

/* 3D logo orbit (CSS) */
.orbit3d { position: relative; height: 380px; perspective: 1100px; overflow: hidden; }
@property --spin { syntax: "<angle>"; inherits: true; initial-value: 0deg; }
.orbit3d .ring { position: absolute; left: 50%; top: 50%; width: 0; height: 0; transform-style: preserve-3d; transform: rotateX(-14deg) rotateY(var(--spin)); animation: orbit 36s linear infinite; }
.orbit3d .core { position: absolute; left: 50%; top: 50%; width: 96px; height: 96px; margin: -48px 0 0 -48px; border-radius: 28px; background: var(--text); color: var(--bg); display: grid; place-items: center; z-index: 1; animation: float 6s ease-in-out infinite; }
.orbit3d .core svg { width: 54px; height: 32px; }
.orbit3d .core svg path { stroke: var(--bg); }
.orbit3d .node { position: absolute; left: -32px; top: -32px; width: 64px; height: 64px; display: grid; place-items: center; border-radius: 18px; border: 1px solid var(--line-2); background: var(--bg-1); color: var(--text); transform: rotateY(var(--a)) translateZ(var(--r, 180px)) rotateY(calc(var(--a) * -1 - var(--spin))) rotateX(14deg); backface-visibility: visible; }
.orbit3d .node svg { width: 28px; height: 28px; }
@keyframes orbit { to { --spin: 360deg; } }
@keyframes float { 50% { transform: translateY(-8px); } }
@media (max-width: 600px) { .orbit3d { height: 300px; } .orbit3d .node { --r: 120px; width: 52px; height: 52px; left: -26px; top: -26px; } }

/* receipt anatomy */
.anatomy { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 32px; align-items: start; }
.anatomy .rcpt { font-size: 13px; padding: 24px; }
.anatomy-list { list-style: none; padding: 0; margin: 0; }
.anatomy-list li { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: 16px; padding: 14px 0; border-top: 1px solid var(--line); font-size: 15px; color: var(--muted); }
.anatomy-list li code { color: var(--text); background: none; border: 0; padding: 0; }
@media (max-width: 860px) { .anatomy { grid-template-columns: minmax(0, 1fr); } .anatomy-list li { grid-template-columns: minmax(0, 1fr); gap: 4px; } }

/* forms and results */
label { display: block; font: 500 12px var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 18px 0 8px; }
input, select, textarea { width: 100%; background: var(--bg); color: var(--text); border: 1px solid var(--line-2); border-radius: 12px; padding: 11px 14px; font: 15px var(--font); min-height: 46px; transition: border-color .2s, box-shadow .2s; }
input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
textarea { min-height: 104px; resize: vertical; line-height: 1.5; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 520px) { .row { grid-template-columns: minmax(0, 1fr); } }
.actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 20px; }
.result { margin-top: 18px; }
.big-price { font: 600 clamp(40px, 5vw, 60px)/1 var(--font); letter-spacing: -0.05em; color: var(--accent); margin: 14px 0 8px; font-variant-numeric: tabular-nums; animation: pop .5s var(--ease-out); }
@keyframes pop { from { opacity: 0; transform: translateY(8px); } }
dl.kv { display: grid; grid-template-columns: max-content 1fr; gap: 8px 16px; margin: 14px 0 0; font-size: 14px; }
dl.kv dt { color: var(--dim); font: 12.5px var(--mono); padding-top: 1px; } dl.kv dd { margin: 0; overflow-wrap: anywhere; font: 13px var(--mono); }
@media (max-width: 520px) { dl.kv { grid-template-columns: minmax(0, 1fr); gap: 2px; } dl.kv dd { margin-bottom: 8px; } }
.badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font: 500 12px var(--mono); border: 1px solid var(--line-2); }
.badge.good { color: var(--mint); border-color: color-mix(in srgb, var(--mint) 50%, transparent); }
.badge.bad { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 50%, transparent); }
.pg-out { min-height: 100%; display: flex; flex-direction: column; }
.kv-list { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 14px 24px; margin: 0; padding: 26px 0 0; border-top: 1px solid var(--line); }
.kv-list dt { font: 12.5px var(--mono); color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
.kv-list dd { margin: 0; font: 600 18px var(--font); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.kv-list dd { min-width: 0; overflow-wrap: anywhere; }
.kv-list dd.mono { font: 500 14px var(--mono); letter-spacing: 0; }
@media (max-width: 520px) { .kv-list { grid-template-columns: minmax(0, 1fr); gap: 4px; } .kv-list dd { margin-bottom: 10px; } }

/* playground: payer and paid runs */
.payer { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; margin-bottom: 16px; padding: 14px 16px; }
.payer-modes { display: flex; gap: 6px; }
.payer-modes .tab .ic { flex: none; }
.payer-pane { flex: 1 1 320px; min-width: 0; display: flex; align-items: center; }
.wallet-list, .mandate-entry, .payer-active { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; width: 100%; }
.wallet-btn img { width: 18px; height: 18px; border-radius: 5px; }
.agent-chip { display: inline-flex; align-items: center; gap: 6px; padding-left: 12px; border: 1px solid var(--line); border-radius: 999px; font-size: 12.5px; color: var(--muted); }
.agent-chip .icon-btn { border: 0; background: none; }
.mandate-entry input { flex: 1 1 220px; min-width: 0; width: auto; min-height: 38px; padding: 7px 12px; font: 13px var(--mono); }
.payer-active .mono { font-size: 13px; color: var(--muted); }
.payer-active .mono:first-of-type { color: var(--text); }
.payer-cap { display: flex; align-items: center; gap: 10px; margin-left: auto; }
.payer-cap label { margin: 0; white-space: nowrap; }
.payer-cap input { width: 96px; min-height: 38px; padding: 7px 12px; font: 13px var(--mono); }
@media (max-width: 700px) { .payer-cap { margin-left: 0; } }
.run-price:not(:empty) { font: 500 13px var(--mono); opacity: .7; margin-left: 2px; }
.run-price:not(:empty)::before { content: "\00b7  "; }
.run-status { display: flex; align-items: center; gap: 12px; margin: auto 0; color: var(--muted); font-size: 15px; }
.spinner { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--line-2); border-top-color: var(--signal); animation: spin .8s linear infinite; flex: none; }
.run-result { margin-bottom: 18px; animation: fade .4s var(--ease-out); }
.answer-text { white-space: pre-wrap; font-size: 16px; line-height: 1.6; }
.image-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
.image-grid img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 12px; background: var(--bg-2); }
.run-result audio, .run-result video { width: 100%; border-radius: 12px; }
.run-receipt { border-top: 1px solid var(--line); padding-top: 14px; }
.run-receipt p { margin: 0; }

/* catalog */
.filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 24px; }
.tab { display: inline-flex; align-items: center; gap: 8px; background: transparent; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 8px 16px; font: 500 14px var(--font); cursor: pointer; min-height: 40px; transition: color .2s, border-color .2s, background-color .2s; }
.tab:hover { color: var(--text); border-color: var(--line-2); }
.tab[aria-pressed="true"] { color: var(--bg); background: var(--text); border-color: var(--text); }
.tab i { width: 7px; height: 7px; border-radius: 50%; background: var(--c, var(--accent)); }
.filters input { flex: 1 1 240px; min-width: 0; width: auto; border-radius: 999px; padding-left: 18px; }
ul.models { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
@media (max-width: 1000px) { ul.models { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 640px) { ul.models { grid-template-columns: minmax(0, 1fr); } }
.model { background: var(--bg-1); border: 1px solid var(--line); border-radius: 20px; padding: 20px; display: flex; flex-direction: column; gap: 12px; min-width: 0; transition: border-color .25s, transform .4s var(--ease-out); animation: fade .4s var(--ease-out); }
.model:hover { border-color: var(--line-2); transform: translateY(-3px); }
.model-top { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.model-id { display: flex; gap: 12px; align-items: center; min-width: 0; }
.model-id .lg { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; background: var(--bg-2); color: var(--text); flex: none; }
.model-id .lg svg { width: 20px; height: 20px; }
.model h3 { margin: 0; font-size: 16px; overflow-wrap: anywhere; }
.model .vendor { font: 12px var(--mono); color: var(--dim); }
.price { font: 500 13px var(--mono); color: var(--text); white-space: nowrap; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.chip { display: inline-flex; align-items: center; gap: 6px; font: 12px var(--mono); padding: 3px 9px; border-radius: 999px; background: var(--bg-2); color: var(--muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip i { width: 6px; height: 6px; border-radius: 50%; background: var(--c); flex: none; }
.endpoint { font: 12px var(--mono); color: var(--dim); background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 7px 10px; overflow-wrap: anywhere; }
button.endpoint { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; min-height: 36px; text-align: left; cursor: copy; transition: color .2s, border-color .2s; }
button.endpoint:hover { color: var(--text); border-color: var(--line-2); }
button.endpoint .ic { flex: none; }
.model-actions { display: flex; gap: 8px; margin-top: auto; flex-wrap: wrap; }
.more { display: flex; justify-content: center; margin-top: 28px; }

/* footer */
footer.site { border-top: 1px solid var(--line); padding: 72px 0 32px; color: var(--muted); font-size: 14px; overflow: hidden; }
.foot-top { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 48px; }
.foot-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 24px; }
.foot-grid h4 { color: var(--text); font: 500 12px var(--mono); text-transform: uppercase; letter-spacing: .1em; margin: 0 0 16px; }
.foot-grid ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
.foot-grid a { color: var(--muted); text-decoration: none; transition: color .2s; } .foot-grid a:hover { color: var(--text); }
.foot-giant { font-weight: 600; font-size: clamp(64px, 18.5vw, 270px); line-height: .8; letter-spacing: -0.07em; color: var(--bg-3); margin: 72px 0 32px; white-space: nowrap; user-select: none; display: flex; align-items: flex-end; }
.foot-giant .dot { display: inline-block; width: .16em; height: .16em; border-radius: 50%; background: var(--signal); margin: 0 0 .02em .03em; flex: none; }
.foot-legal { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding-top: 24px; border-top: 1px solid var(--line); font-size: 13px; overflow-wrap: anywhere; }
.foot-legal > span { min-width: 0; }
@media (max-width: 960px) { .foot-top { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 1100px) and (min-width: 601px) { .foot-grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 600px) { .foot-grid { grid-template-columns: 1fr 1fr; gap: 32px 16px; } }
.toast { position: fixed; bottom: 24px; left: 50%; transform: translate(-50%, 12px); background: var(--text); color: var(--bg); padding: 10px 18px; border-radius: 999px; font: 500 14px var(--font); opacity: 0; transition: opacity .25s, transform .4s var(--ease-out); pointer-events: none; z-index: 60; }
.toast.show { opacity: 1; transform: translate(-50%, 0); }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; scroll-behavior: auto !important; }
  .marquee-track { animation: none !important; }
  .marquee { overflow-x: auto; }
}
`;
