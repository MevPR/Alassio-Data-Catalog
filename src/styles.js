export const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap');

:root {
  --bg: #F5F5F5;
  --panel: #FFFFFF;
  --ink: #1D1D1B;
  --muted: #6B6B68;
  --line: #E2E2E0;
  /* v1.79: brand colour sky blue, RAL 5015 "Himmelblau" (sRGB #2271B3), with a teal accent (v1.78: indigo; v1.76–v1.77
     and v1.0–v1.75 used colours from other companies' palettes); change the brand tokens here and the whole UI, the help
     figures and the handbook follow */
  --brand: #2271B3;
  --brand-dark: #1A5A8F;
  --brand-soft: #E4EEF7;
  --accent: #0F766E;
  --accent-soft: #E0F2EF;
  --amber: #A85F00;
  --amber-soft: #FBEFD9;
  --red: #B03A2E;
  --red-soft: #F9E5E2;
  --green: #1F7A4D;
  --green-soft: #E2F2E9;
}
* { box-sizing: border-box; }
.dc-root {
  font-family: 'Inter', system-ui, sans-serif;
  background: var(--bg); color: var(--ink);
  height: 100vh; display: flex; flex-direction: column; overflow: hidden;
  font-size: 14px; line-height: 1.5;
}
.dc-root h1,.dc-root h2,.dc-root h3 { font-family:'Barlow',sans-serif; margin:0; letter-spacing:-0.005em; }
.mono { font-family:'JetBrains Mono',monospace; }

/* top bar with the brand band */
.brandband { height: 4px; background: var(--brand); flex-shrink: 0; }
.topbar { display:flex; align-items:center; gap:16px; padding:10px 20px; background:var(--panel); border-bottom:1px solid var(--line); flex-shrink:0; flex-wrap:wrap; }
.brand { display:flex; align-items:center; gap:12px; cursor:pointer; }
.brand-mark { background: var(--brand); color:#fff; font-family:'Barlow'; font-weight:700; font-size:14px; letter-spacing:.06em; padding:7px 10px 6px; border-radius:2px; }
.brand-name { font-family:'Barlow'; font-weight:600; font-size:16px; line-height:1.15; }
.brand-sub { font-size:11px; color:var(--muted); letter-spacing:.08em; text-transform:uppercase; }
.searchbox { flex:1; min-width:180px; max-width:420px; display:flex; align-items:center; gap:8px; background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:7px 12px; }
.searchbox input { border:none; outline:none; background:transparent; flex:1; font:inherit; color:var(--ink); }
.topbar-actions { margin-left:auto; display:flex; gap:8px; flex-wrap:wrap; }

/* buttons */
.btn { display:inline-flex; align-items:center; gap:6px; border-radius:8px; padding:7px 13px; font:inherit; font-weight:500; cursor:pointer; border:1px solid var(--line); background:var(--panel); color:var(--ink); transition:background .12s, border-color .12s; }
.btn:hover { background:#F6F6F5; }
.btn:focus-visible, .tab:focus-visible, .card:focus-visible, .tree-row:focus-visible, .role-row:focus-visible, .menu-item:focus-visible, .brand:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline:2px solid var(--brand); outline-offset:2px; }
.field input:focus-visible, .field select:focus-visible, .field textarea:focus-visible { outline:none; }
/* accessibility helpers (v1.57) */
.skip-link { position:absolute; left:8px; top:-48px; z-index:100; background:var(--brand); color:#fff; padding:8px 14px; border-radius:8px; font-weight:600; text-decoration:none; transition:top .12s; }
.skip-link:focus { top:8px; }
.sr-live { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); clip-path:inset(50%); white-space:nowrap; }
.rail-toggle, .rail-close { display:none; }
.rail-backdrop { display:none; }
.btn-primary { background:var(--brand); border-color:var(--brand); color:#fff; }
.btn-primary:hover { background:var(--brand-dark); }
.btn-badged { position:relative; overflow:visible; }
.badge { position:absolute; top:-7px; right:-7px; min-width:18px; height:18px; padding:0 5px; border-radius:6px; background:var(--brand); color:#fff; font-size:11px; font-weight:700; line-height:18px; text-align:center; box-shadow:0 0 0 2px var(--panel); pointer-events:none; }
.btn-primary .badge { background:#fff; color:var(--brand); box-shadow:0 0 0 2px var(--brand); }
.btn-ghost { border-color:transparent; background:transparent; color:var(--muted); padding:5px 8px; }
.btn-ghost:hover { background:#EFEFEE; color:var(--ink); }
.btn-danger { color:var(--red); }
.btn-sm { padding:4px 9px; font-size:13px; }

/* layout */
.body { display:flex; flex:1; min-height:0; }
.rail { width:310px; flex-shrink:0; background:var(--panel); border-right:1px solid var(--line); display:flex; flex-direction:column; }
.rail-head { padding:14px 16px 8px; display:flex; align-items:center; justify-content:space-between; }
.rail-title { font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); font-weight:600; }
.tree { overflow-y:auto; padding:4px 8px 20px; flex:1; }
.tree-row { display:flex; align-items:center; gap:6px; padding:5px 8px; border-radius:7px; cursor:pointer; color:var(--ink); position:relative; }
.tree-row:hover { background:#F3F3F2; }
.tree-row.sel { background:var(--brand-soft); color:var(--brand-dark); font-weight:500; }
.tree-row.hub-row { font-family:'Barlow'; font-weight:600; font-size:14px; margin-top:6px; }
.tree-row.hub-row .hub-ic { color: var(--brand); }
.tree-row .mono { font-size:13px; }
.tree-kids { margin-left:14px; border-left:1px solid var(--line); padding-left:6px; }
.tree-sep { border-top:1px solid var(--line); margin:10px 4px 2px; }   /* v1.64.1: the SOURCE hub sits below the other data hub types */
.tree-count { margin-left:auto; font-size:11px; color:var(--muted); font-family:'Inter'; font-weight:400; }

/* main */
.main { flex:1; overflow-y:auto; padding:24px 32px 48px; }
.crumb { display:flex; align-items:center; gap:8px; font-family:'JetBrains Mono',monospace; font-size:13px; color:var(--muted); margin-bottom:16px; flex-wrap:wrap; }
.crumb b { color:var(--ink); font-weight:600; }
.crumb .dot { color:var(--brand); font-weight:700; }

.entity-head { display:flex; align-items:flex-start; gap:14px; margin-bottom:6px; flex-wrap:wrap; }
.entity-icon { width:44px; height:44px; border-radius:10px; display:grid; place-items:center; background:var(--brand-soft); color:var(--brand-dark); flex-shrink:0; }
.entity-icon.blue { background:var(--accent-soft); color:var(--accent); }
.entity-title { font-size:26px; font-weight:600; }
.entity-sub { color:var(--muted); margin-top:2px; max-width:640px; }
.head-actions { margin-left:auto; display:flex; gap:8px; flex-wrap:wrap; }

.chip { display:inline-flex; align-items:center; gap:5px; font-size:12px; font-weight:600; padding:2px 9px; border-radius:99px; }
.chip-brand { background:var(--brand-soft); color:var(--brand-dark); }
.chip-blue { background:var(--accent-soft); color:var(--accent); }
.chip-amber { background:var(--amber-soft); color:var(--amber); }
.chip-red { background:var(--red-soft); color:var(--red); }
.chip-grey { background:#EFEFEE; color:var(--muted); }
.chip-green { background:var(--green-soft); color:var(--green); }
.chip-mono { font-family:'JetBrains Mono'; font-weight:500; }

.tabs { display:flex; gap:4px; border-bottom:1px solid var(--line); margin:20px 0 18px; }
.tab { padding:8px 14px; border:none; background:none; font:inherit; font-weight:500; color:var(--muted); cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px; }
.tab.on { color:var(--brand-dark); border-bottom-color:var(--brand); }

.cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:14px; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; cursor:pointer; transition:border-color .12s; }
.card:hover { border-color:var(--brand); }
.hub-card { border-top:3px solid var(--brand); }
.card-title { display:flex; align-items:center; gap:8px; font-weight:600; font-size:14px; }
.card-title.mono-t { font-family:'JetBrains Mono'; }
.card-title.hub-t { font-family:'Barlow'; font-size:16px; }
.card-desc { color:var(--muted); font-size:13px; margin-top:6px; min-height:20px; }
.card-meta { display:flex; gap:6px; margin-top:10px; flex-wrap:wrap; }

.kv-grid { display:grid; grid-template-columns:180px 1fr; gap:10px 18px; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:18px 20px; }
.kv-k { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); font-weight:600; padding-top:2px; }
.kv-v { min-height:22px; }

table.attrs { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
.attrs th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.07em; color:var(--muted); padding:10px 12px; border-bottom:1px solid var(--line); background:#FAFAF9; font-weight:600; }
.attrs td { padding:9px 12px; border-bottom:1px solid #F0F0EF; vertical-align:top; }
.attrs tr:last-child td { border-bottom:none; }
.attrs tr:hover td { background:#FCFCFB; }

.empty { border:1.5px dashed var(--line); border-radius:12px; padding:40px; text-align:center; color:var(--muted); background:var(--panel); }

/* modal */
.overlay { position:fixed; inset:0; background:rgba(29,29,27,.5); display:grid; place-items:center; z-index:50; padding:20px; font-family:'Inter', system-ui, sans-serif; color:var(--ink); font-size:14px; line-height:1.5; }   /* v1.70: the confirm dialog renders beside .dc-root */
.overlay h3 { font-family:'Barlow',sans-serif; margin:0; letter-spacing:-0.005em; }
.modal { background:var(--panel); border-radius:14px; width:100%; max-width:560px; max-height:90vh; overflow-y:auto; padding:24px; box-shadow:0 20px 60px rgba(29,29,27,.25); border-top:4px solid var(--brand); }
.modal h3 { font-size:19px; margin-bottom:4px; }
.modal-sub { color:var(--muted); font-size:13px; margin-bottom:18px; }
.field { margin-bottom:14px; }
.field label { display:block; font-size:12px; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; margin-bottom:5px; }
.field input, .field select, .field textarea { width:100%; font:inherit; padding:8px 11px; border:1px solid var(--line); border-radius:8px; background:var(--panel); color:var(--ink); outline:none; }
.field input:focus, .field select:focus, .field textarea:focus { border-color:var(--brand); box-shadow:0 0 0 3px var(--brand-soft); }
.field input:disabled { background:#F4F4F3; color:var(--muted); }
.field textarea { resize:vertical; min-height:70px; }
.field-row { display:flex; gap:12px; }
.field-row .field { flex:1; }
.modal-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:8px; }
.modal.modal-confirm { max-width:460px; }   /* v1.70: confirm / prompt dialogs stay compact */
.confirm-text { margin:2px 0 16px; line-height:1.5; }
.check { display:flex; align-items:center; gap:8px; font-size:14px; color:var(--ink); }
.check input { width:auto; }

.notice { border-radius:10px; padding:10px 14px; font-size:13px; display:flex; gap:8px; align-items:flex-start; margin-bottom:14px; }
.notice-ok { background:var(--green-soft); color:var(--green); }
.notice-err { background:var(--red-soft); color:var(--red); }
.notice-warn { background:var(--amber-soft); color:var(--amber); }
.notice:not(.notice-ok):not(.notice-err):not(.notice-warn) { background:var(--accent-soft); color:var(--accent); }

/* governance */
.gov-grid { display:grid; grid-template-columns:1fr 1fr; gap:18px; align-items:start; }
@media (max-width:980px){ .gov-grid{grid-template-columns:1fr;} .rail{width:250px;} .main{padding:18px;} }
/* mobile (v1.57): the tree becomes an off-canvas drawer, top-bar buttons collapse to icons, grids stack, tables scroll */
@media (max-width:760px){
  .topbar { gap:8px; padding:8px 10px; }
  .rail-toggle, .rail-close { display:inline-flex; }
  .brand-sub { display:none; }
  .brand-name { font-size:14px; }
  .searchbox { order:10; flex-basis:100%; max-width:none; }
  .topbar .btn-txt { display:none; }
  .topbar-actions { gap:6px; }
  .topbar-user .role-name { display:none; }
  .rail { position:fixed; top:0; bottom:0; left:0; width:min(86vw, 320px); z-index:45; transform:translateX(-105%); transition:transform .18s ease-out; box-shadow:0 0 40px rgba(0,0,0,.25); }
  .rail.open { transform:none; }
  .rail-backdrop { display:block; position:fixed; inset:0; background:rgba(29,29,27,.45); z-index:44; }
  .main { padding:14px 14px 40px; }
  .entity-title { font-size:20px; }
  .entity-head { gap:10px; }
  .head-actions { margin-left:0; width:100%; }
  .kv-grid { grid-template-columns:1fr; gap:4px 0; padding:14px; }
  .kv-k { margin-top:8px; }
  .field-row { flex-wrap:wrap; }
  .field-row .field { flex-basis:100%; }
  .modal { padding:16px; max-height:96vh; border-radius:12px; }
  .overlay { padding:8px; align-items:end; }
  table.attrs, .panel > table.attrs { display:block; overflow-x:auto; -webkit-overflow-scrolling:touch; }
  .tabs { overflow-x:auto; }
  .cards { grid-template-columns:1fr; }
  .toast { left:12px; right:12px; bottom:12px; }
}
@media (pointer:coarse){ .btn, .tab, .menu-item, .tree-row { min-height:40px; } .btn-sm { min-height:36px; } }
.panel { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:18px 20px; }
.panel h3 { font-size:16px; display:flex; align-items:center; gap:8px; margin-bottom:12px; }
.role-row { display:flex; align-items:center; gap:10px; padding:9px 0; border-bottom:1px solid #F0F0EF; }
.role-row:last-child { border-bottom:none; }
.avatar { width:30px; height:30px; border-radius:99px; background:var(--accent); color:#fff; display:grid; place-items:center; font-size:12px; font-weight:600; flex-shrink:0; }
.lin-wrap { background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:auto; max-height:calc(100vh - 240px); }
.lin-node { position:absolute; width:232px; height:58px; background:#fff; border:1px solid var(--line); border-radius:10px; padding:8px 12px; text-align:left; cursor:pointer; font:inherit; transition:border-color .12s; }
.lin-node:hover { border-color:var(--brand); }
.lin-node:focus-visible { outline:2px solid var(--brand); outline-offset:2px; }
.lin-col-h { position:absolute; top:16px; font-family:'Barlow'; font-weight:700; letter-spacing:.09em; font-size:12px; }
.lin-name { font-family:'JetBrains Mono'; font-weight:600; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.lin-sub { font-size:11px; color:var(--muted); margin-top:2px; }
.log-box { max-height:220px; overflow-y:auto; border:1px solid var(--line); border-radius:10px; padding:8px 12px; margin-bottom:14px; }
.log-row { display:flex; gap:8px; align-items:flex-start; font-size:13px; padding:4px 0; border-bottom:1px solid #F0F0EF; }
.log-row:last-child { border-bottom:none; }
.role-switch { display:flex; align-items:center; gap:7px; border:1px solid var(--line); border-radius:8px; padding:0 8px 0 11px; background:var(--accent-soft); color:var(--accent); }
.role-switch select { border:none; background:transparent; font:inherit; font-weight:600; color:var(--accent); padding:7px 2px; outline:none; cursor:pointer; }
.role-switch:focus-within { outline:2px solid var(--brand); outline-offset:2px; }
.topbar-user { margin-left:auto; }
.role-name { font-weight:600; font-size:13px; max-width:180px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.auth-bg { flex:1; display:grid; place-items:center; padding:24px; }
.auth-card { width:100%; max-width:420px; background:var(--panel); border:1px solid var(--line); border-radius:14px; border-top:4px solid var(--brand); padding:28px; box-shadow:0 20px 60px rgba(29,29,27,.12); }
.auth-card h2 { font-size:21px; margin-bottom:4px; }
.auth-sub { color:var(--muted); font-size:13px; margin-bottom:18px; }
.secret-box { font-family:'JetBrains Mono'; font-size:13px; background:#F6F6F5; border:1px solid var(--line); border-radius:8px; padding:10px 12px; word-break:break-all; margin-bottom:12px; }
.modal-wide { max-width:780px; }
.modal-help { max-width:960px; }
.audit-row { border-bottom:1px solid #F0F0EF; }
.audit-row:last-child { border-bottom:none; }
.audit-head { display:flex; align-items:center; gap:10px; padding:10px 6px; cursor:pointer; flex-wrap:wrap; }
.audit-head:hover { background:#FAFAF9; }
.audit-type { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); font-weight:600; }
.audit-ctx { font-family:'JetBrains Mono'; font-size:12px; color:var(--muted); }
.audit-meta { margin-left:auto; font-size:12px; color:var(--muted); white-space:nowrap; }
.audit-detail { padding:2px 10px 12px; }
.audit-change { display:flex; gap:10px; align-items:baseline; font-size:13px; padding:3px 0; flex-wrap:wrap; }
.audit-field { font-family:'JetBrains Mono'; font-weight:600; min-width:130px; }
.audit-from { color:var(--red); text-decoration:line-through; text-decoration-color:rgba(176,58,46,.45); overflow-wrap:anywhere; max-width:270px; }
.audit-to { color:var(--green); overflow-wrap:anywhere; max-width:270px; }
.sr-row { display:flex; gap:12px; align-items:center; width:100%; padding:10px 8px; border:none; background:none; font:inherit; color:var(--ink); cursor:pointer; border-bottom:1px solid #F0F0EF; }
.sr-row:last-child { border-bottom:none; }
.sr-row:hover { background:#FAFAF9; }
.sr-snippet { font-size:12px; color:var(--muted); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.exp-tree { max-height:340px; overflow-y:auto; border:1px solid var(--line); border-radius:10px; padding:8px 12px; margin-bottom:14px; }
.exp-row-label { display:flex; align-items:center; gap:8px; padding:4px 0; cursor:pointer; }
.exp-row-label input { width:auto; accent-color:var(--brand); }
.help-sec { display:flex; gap:12px; padding:11px 0; border-bottom:1px solid #F0F0EF; }
.help-sec:last-child { border-bottom:none; }
.help-sec-icon { color:var(--brand); flex-shrink:0; margin-top:2px; }
.help-sec b { display:block; margin-bottom:2px; }
.help-sec p { margin:0; font-size:13px; color:var(--muted); }
.country-code { font-family:'JetBrains Mono'; font-weight:600; font-size:12px; letter-spacing:.05em; color:var(--accent); }
.help-list { margin: 6px 0 8px 18px; padding: 0; } .help-list li { margin: 4px 0; line-height: 1.45; }
.help-sec p { margin: 4px 0 6px; } .help-sec code { font-family: 'JetBrains Mono'; font-size: 12px; background: #F3F3F1; padding: 1px 4px; border-radius: 4px; }
/* help v2 (v1.62): chapter navigation, role chips, search */
.help-layout { display:flex; gap:18px; align-items:flex-start; }
.help-nav { width:200px; flex-shrink:0; display:flex; flex-direction:column; gap:4px; position:sticky; top:0; }
.help-search { width:100%; margin-bottom:6px; font-size:13px; }
.help-nav-btn { display:flex; align-items:center; gap:8px; width:100%; text-align:left; padding:7px 10px; border:1px solid transparent; border-radius:8px; background:none; color:var(--ink); font:inherit; font-size:13px; cursor:pointer; }
.help-nav-btn:hover { background:#F3F3F1; }
.help-nav-btn.active { background:var(--accent-soft); color:var(--accent); border-color:var(--accent-soft); font-weight:600; }
.help-nav-btn svg { flex-shrink:0; color:var(--brand); }
.help-body { flex:1; min-width:0; }
.help-h { font-size:16px; margin:0 0 4px; }
.help-roles { display:flex; flex-wrap:wrap; gap:6px; margin:6px 0 12px; }
.help-roles .chip { cursor:pointer; border:none; font:inherit; font-size:12px; }
.help-crumb { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin-top:10px; }
.help-steps li { margin:5px 0; }
@media (max-width:760px) { .help-layout { flex-direction:column; } .help-nav { width:100%; position:static; flex-direction:row; flex-wrap:wrap; } .help-nav-btn { width:auto; } .help-search { flex-basis:100%; } }
/* v1.65: handbook — figures, examples, tips in the help dialog and the printable manual page */
.help-figure { margin:10px 0 8px; padding:10px 12px; border:1px solid var(--line); border-radius:10px; background:#FAFAF9; }
.help-figure figcaption { font-size:11.5px; color:var(--muted); margin-top:6px; }
.help-fig-note { font-size:11px; color:var(--muted); margin-top:6px; }
.help-example { margin:8px 0; padding:10px 12px; border-left:3px solid var(--accent); background:var(--accent-soft); border-radius:0 8px 8px 0; }
.help-tips { margin:8px 0; padding:8px 12px; border-left:3px solid var(--amber); background:#FBF6E8; border-radius:0 8px 8px 0; }
.help-example-h { display:flex; align-items:center; gap:6px; font-weight:600; font-size:12.5px; margin-bottom:4px; color:var(--ink); }
.help-example p, .help-tips li { color:var(--ink); }
.manual { max-width:900px; margin:0 auto; padding:24px 28px 60px; font-family:'Inter', system-ui, sans-serif; color:var(--ink); background:#fff; }
.manual-bar { display:flex; gap:8px; align-items:center; position:sticky; top:0; background:#fff; padding:8px 0 12px; border-bottom:1px solid var(--line); margin-bottom:20px; z-index:2; }
.manual-cover { text-align:center; padding:30px 0 20px; border-bottom:1px solid var(--line); }
.manual-cover h1 { font-family:'Barlow'; font-size:34px; margin:10px 0 6px; }
.manual-sub { color:var(--muted); font-size:14px; max-width:640px; margin:0 auto 6px; }
.manual-meta { font-size:12px; color:var(--muted); }
.manual-intro { color:var(--muted); font-size:13.5px; max-width:720px; margin:8px auto 0; }
.manual-toc { padding:18px 0; border-bottom:1px solid var(--line); }
.manual-toc h2 { font-family:'Barlow'; font-size:20px; margin:0 0 8px; }
.manual-toc ol { padding-left:22px; margin:4px 0; font-size:13.5px; } .manual-toc li { margin:3px 0; } .manual-toc a { color:var(--accent); text-decoration:none; } .manual-toc a:hover { text-decoration:underline; }
.manual-chapter { padding-top:26px; } .manual-chapter > h2 { font-family:'Barlow'; font-size:24px; margin:0 0 4px; color:var(--brand-dark); page-break-before:always; }
.manual-chapter:first-of-type > h2 { page-break-before:auto; }
.manual-section { padding:14px 0; border-bottom:1px solid #F0F0EF; page-break-inside:avoid; } .manual-section h3 { font-family:'Barlow'; font-size:17px; margin:0 0 6px; }
.manual-section p { font-size:13.5px; line-height:1.55; margin:4px 0 8px; } .manual-section .help-list li { font-size:13.5px; }
.manual-foot { margin-top:30px; font-size:12px; color:var(--muted); text-align:center; }
@media print {
  .no-print { display:none !important; }
  .manual { max-width:none; padding:0; }
  .manual-cover { page-break-after:always; border:none; }
  .manual-toc { page-break-after:always; border:none; }
  .help-figure { background:#fff; } .help-example, .help-tips { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .help-code { background:#F3F3F1 !important; color:#1D1D1B !important; border:1px solid var(--line); white-space:pre-wrap; }
  a { color:inherit; text-decoration:none; }
}
.help-code { font-family: 'JetBrains Mono'; font-size: 11.5px; background: #1D1D1B; color: #E8E8E6; padding: 8px 10px; border-radius: 8px; overflow-x: auto; margin: 6px 0 8px; white-space: pre; }
.menu-wrap { position: relative; }
.menu-pop { position: absolute; top: calc(100% + 4px); left: 0; min-width: 190px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.12); padding: 6px; z-index: 30; display: flex; flex-direction: column; gap: 2px; }
.menu-item { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 8px 10px; border: 0; background: transparent; border-radius: 7px; font: inherit; cursor: pointer; color: var(--ink); }
.menu-item:hover { background: #F3F3F1; } .menu-item.active { color: var(--brand); font-weight: 600; }
.edge-row { cursor: pointer; } .edge-row:hover { background: #FAFAF8; }
.stat-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; }
.stat-card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px 18px; border-top:3px solid var(--brand); }
.stat-num { font-family:'Barlow'; font-weight:700; font-size:32px; line-height:1.1; }
.stat-label { font-weight:600; margin-top:2px; }
.stat-sub { font-size:12px; color:var(--muted); margin-top:2px; }
.stat-bar { height:6px; background:#EFEFEE; border-radius:99px; margin-top:10px; overflow:hidden; }
.stat-bar-fill { height:100%; border-radius:99px; transition:width .3s; }
button:disabled { opacity:.45; cursor:not-allowed; }
.toast { font-family:'Inter', system-ui, sans-serif; position:fixed; bottom:22px; right:22px; background:var(--ink); color:#fff; padding:11px 16px; border-radius:10px; display:flex; gap:8px; align-items:center; z-index:60; box-shadow:0 8px 30px rgba(0,0,0,.25); }
.spin { animation: rot 1s linear infinite; } @keyframes rot { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce){ .spin { animation:none; } .rail { transition:none; } .skip-link { transition:none; } }
@media (prefers-reduced-motion: no-preference){ .toast{animation:pop .18s ease-out;} @keyframes pop{from{transform:translateY(8px);opacity:0}to{transform:none;opacity:1}} }
`;
