/* Help illustrations (v1.65): small inline SVG figures used by the help dialog and the printable handbook.
   Every figure receives its labels (translated in help-manual.js) and renders as an accessible <svg role="img">.
   Colours follow the UI palette so the figures print and read well in every language. */

const BRAND = "#2271B3", BLUE = "#0F766E", BLUE_SOFT = "#E0F2EF", BRAND_SOFT = "#E4EEF7", INK = "#1D1D1B", MUTED = "#6B6B68", LINE = "#C9C9C6", GREEN = "#1F7A4D", AMBER = "#A85F00";
const LAYER = { source: "#0F766E", bronze: "#9C5B21", silver: "#5F6B73", gold: "#A8790A" };
const F = { fontFamily: "Barlow, Arial, sans-serif" };

/* ── primitives ── */
const Box = ({ x, y, w, h, label, sub, fill = "#fff", stroke = LINE, color = INK, bold = false, r = 8, size = 12 }) => (
  <g>
    <rect x={x} y={y} width={w} height={h} rx={r} fill={fill} stroke={stroke} strokeWidth="1.2" />
    <text x={x + w / 2} y={y + (sub ? h / 2 - 3 : h / 2 + 4)} textAnchor="middle" fontSize={size} fontWeight={bold ? 600 : 500} fill={color} style={F}>{label}</text>
    {sub && <text x={x + w / 2} y={y + h / 2 + 12} textAnchor="middle" fontSize={size - 2} fill={MUTED} style={F}>{sub}</text>}
  </g>
);
const Arrow = ({ x1, y1, x2, y2, color = MUTED, dashed = false, label, labelDy = -5 }) => (
  <g>
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="1.4" strokeDasharray={dashed ? "4 3" : undefined} markerEnd={`url(#ah-${color.replace("#", "")})`} />
    {label && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 + labelDy} textAnchor="middle" fontSize="10" fill={color} style={F}>{label}</text>}
  </g>
);
const Markers = () => (
  <defs>
    {[MUTED, BRAND, BLUE, GREEN, AMBER].map((c) => (
      <marker key={c} id={`ah-${c.replace("#", "")}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill={c} /></marker>
    ))}
  </defs>
);
const Svg = ({ w, h, title, note, children }) => (
  <>
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title} className="help-fig" style={{ width: "100%", maxWidth: w, height: "auto", display: "block" }}>
      <title>{title}</title>
      <Markers />
      {children}
    </svg>
    {note && <div className="help-fig-note">{note}</div>}
  </>
);

/* ── 1. hierarchy: Data Hub Type → Data Hub → Database → Schema → Table → Attribute, SOURCE last ── */
export const FigHierarchy = ({ L }) => {
  const rows = [[L.hubType, "Sales", BLUE], [L.hub, "SALES_DE", BLUE], [L.database, "GOLD", LAYER.gold], [L.schema, "partners", MUTED], [L.table, "loss_ratio", MUTED], [L.attribute, "loss_ratio_pct", MUTED]];
  return (
    <Svg w={720} h={250} title={L.title}>
      {rows.map(([lvl, ex, col], i) => {
        const x = 20 + i * 34, y = 14 + i * 32;
        return (
          <g key={lvl}>
            {i > 0 && <path d={`M${x - 20} ${y - 14} v18 h14`} fill="none" stroke={LINE} strokeWidth="1.4" />}
            <rect x={x} y={y} width={150} height={24} rx="6" fill={i < 2 ? BLUE_SOFT : "#fff"} stroke={i < 2 ? BLUE : LINE} />
            <text x={x + 8} y={y + 16} fontSize="12" fontWeight="600" fill={col} style={F}>{lvl}</text>
            <text x={x + 162} y={y + 16} fontSize="12" fill={MUTED} style={{ ...F, fontFamily: "JetBrains Mono, monospace" }}>{ex}</text>
          </g>
        );
      })}
      <text x={420} y={30} fontSize="11" fill={MUTED} style={F}>{L.note1}</text>
      <text x={420} y={46} fontSize="11" fill={MUTED} style={F}>{L.note2}</text>
      <text x={420} y={62} fontSize="11" fill={MUTED} style={F}>{L.note3}</text>
      <line x1={20} y1={218} x2={360} y2={218} stroke={LINE} strokeDasharray="3 3" />
      <rect x={20} y={226} width={150} height={20} rx="6" fill={BRAND_SOFT} stroke={BRAND} />
      <text x={28} y={240} fontSize="12" fontWeight="600" fill={BRAND} style={F}>SOURCE</text>
      <text x={182} y={240} fontSize="11" fill={MUTED} style={F}>{L.sourceNote}</text>
    </Svg>
  );
};

/* ── 2. medallion layers: sources → bronze → silver → gold → consumers ── */
export const FigLayers = ({ L }) => (
  <Svg w={750} h={110} title={L.title} note={L.note}>
    <Box x={10} y={30} w={118} h={54} label={L.sources} sub={L.sourcesSub} fill="#fff" stroke={LAYER.source} color={LAYER.source} />
    <Arrow x1={128} y1={57} x2={184} y2={57} label={L.ingest} labelDy={-7} />
    <Box x={184} y={30} w={112} h={54} label="Bronze" sub={L.bronze} fill="#FBF3EC" stroke={LAYER.bronze} color={LAYER.bronze} bold />
    <Arrow x1={296} y1={57} x2={332} y2={57} />
    <Box x={332} y={30} w={112} h={54} label="Silver" sub={L.silver} fill="#F1F2F3" stroke={LAYER.silver} color={LAYER.silver} bold />
    <Arrow x1={444} y1={57} x2={480} y2={57} />
    <Box x={480} y={30} w={112} h={54} label="Gold" sub={L.gold} fill="#FBF6E8" stroke={LAYER.gold} color={LAYER.gold} bold />
    <Arrow x1={592} y1={57} x2={660} y2={57} label={L.publish} labelDy={-7} />
    <Box x={660} y={30} w={84} h={54} label={L.consumers} sub={L.consumersSub} fill={BLUE_SOFT} stroke={BLUE} color={BLUE} size={11} />
  </Svg>
);

/* ── 3. ownership inheritance: hub BPO → domain → database → schema → table, overridable at every level ── */
export const FigOwnership = ({ L }) => {
  const lv = [[L.hub, "BPO: Anna Weber"], [L.domain, `${L.owner}: —  ·  ${L.steward}: Jonas Klein`], [L.database, "—"], [L.schema, `${L.steward}: Priya Nair`], [L.table, `${L.effective}: Anna Weber / Priya Nair`]];
  return (
    <Svg w={740} h={236} title={L.title}>
      {lv.map(([lvl, val], i) => {
        const y = 12 + i * 44;
        return (
          <g key={lvl}>
            <rect x={20} y={y} width={120} height={30} rx="6" fill={i === 4 ? BLUE_SOFT : "#fff"} stroke={i === 4 ? BLUE : LINE} />
            <text x={80} y={y + 19} textAnchor="middle" fontSize="12" fontWeight="600" fill={INK} style={F}>{lvl}</text>
            <text x={154} y={y + 19} fontSize="11.5" fill={i === 4 ? BLUE : MUTED} fontWeight={i === 4 ? 600 : 400} style={F}>{val}</text>
            {i < 4 && <Arrow x1={80} y1={y + 30} x2={80} y2={y + 44} color={i === 1 || i === 3 ? BRAND : MUTED} />}
          </g>
        );
      })}
      <text x={430} y={40} fontSize="11" fill={MUTED} style={F}>{L.rule1}</text>
      <text x={430} y={56} fontSize="11" fill={MUTED} style={F}>{L.rule2}</text>
      <text x={430} y={72} fontSize="11" fill={BRAND} style={F}>{L.rule3}</text>
      <text x={430} y={88} fontSize="11" fill={MUTED} style={F}>{L.rule4}</text>
    </Svg>
  );
};

/* ── 4. lineage: two bronze sources → a gold table, with a column mapping ── */
export const FigLineage = ({ L }) => (
  <Svg w={700} h={172} title={L.title}>
    <Box x={10} y={20} w={170} h={44} label="bronze.raw.claims_raw" sub={`${L.layer}: Bronze`} stroke={LAYER.bronze} color={LAYER.bronze} />
    <Box x={10} y={100} w={170} h={44} label="bronze.raw.partners" sub={`${L.layer}: Bronze`} stroke={LAYER.bronze} color={LAYER.bronze} />
    <Arrow x1={180} y1={42} x2={300} y2={76} color={BLUE} label={L.mapping} labelDy={-10} />
    <Arrow x1={180} y1={122} x2={300} y2={90} color={BLUE} />
    <Box x={300} y={58} w={190} h={48} label="gold.partners.loss_ratio" sub={`${L.layer}: Gold`} fill="#FBF6E8" stroke={LAYER.gold} color={LAYER.gold} bold />
    <Arrow x1={490} y1={82} x2={580} y2={82} dashed label={L.downstream} labelDy={-7} />
    <Box x={580} y={64} w={100} h={36} label={L.report} fill={BLUE_SOFT} stroke={BLUE} color={BLUE} />
    <text x={10} y={164} fontSize="10.5" fill={MUTED} style={{ ...F, fontFamily: "JetBrains Mono, monospace" }}>claims_raw.paid_amount + partners.premium → loss_ratio_pct</text>
  </Svg>
);

/* ── 5. data product workflow: three phases, steps, acting roles ── */
export const FigWorkflow = ({ L }) => {
  const phases = [[L.p1, [[L.s1, "PM"], [L.s2, "BA"], [L.s3, "BPO"], [L.s4, "DI"]], BRAND], [L.p2, [[L.s5, "BA"]], AMBER], [L.p3, [[L.s6, "D&T"], [L.s7, "D&T"], [L.s8, "D&T"], [L.s9, "D&T"], [L.s10, "PM"]], GREEN]];
  let x = 10; const out = [];
  phases.forEach(([ph, steps, col], pi) => {
    const w = Math.max(steps.length * 62 + 8, Math.round(ph.length * 6.4) + 20);
    out.push(<rect key={`p${pi}`} x={x} y={10} width={w} height={118} rx="10" fill="none" stroke={col} strokeDasharray="4 3" />);
    out.push(<text key={`pt${pi}`} x={x + 8} y={28} fontSize="11.5" fontWeight="600" fill={col} style={F}>{ph}</text>);
    steps.forEach(([s, role], si) => {
      const cx = x + 8 + si * 62 + 27;
      out.push(<g key={`s${pi}${si}`}>
        <circle cx={cx} cy={62} r={13} fill={pi === 0 && si === 0 ? col : "#fff"} stroke={col} strokeWidth="1.5" />
        <text x={cx} y={66} textAnchor="middle" fontSize="10" fontWeight="600" fill={pi === 0 && si === 0 ? "#fff" : col} style={F}>{role}</text>
        <text x={cx} y={94} textAnchor="middle" fontSize="9.5" fill={INK} style={F}>{s}</text>
        {!(pi === phases.length - 1 && si === steps.length - 1) && <line x1={cx + 13} y1={62} x2={cx + 49} y2={62} stroke={LINE} strokeWidth="1.4" />}
      </g>);
    });
    x += w + 10;
  });
  return (
    <Svg w={x + 70} h={136} title={L.title} note={L.legend}>
      {out}
      <Box x={x} y={46} w={64} h={32} label={L.done} fill="#E6F2EB" stroke={GREEN} color={GREEN} bold size={11} />
    </Svg>
  );
};

/* ── 6. access request: reader → request → owner + admins → decision → notification ── */
export const FigAccess = ({ L }) => (
  <Svg w={760} h={100} title={L.title}>
    <Box x={10} y={30} w={110} h={48} label={L.reader} sub={L.readerSub} />
    <Arrow x1={120} y1={54} x2={204} y2={54} label={L.request} labelDy={-7} />
    <Box x={204} y={30} w={140} h={48} label={L.product} sub="Gold · Data Product" fill="#FBF6E8" stroke={LAYER.gold} color={LAYER.gold} />
    <Arrow x1={344} y1={54} x2={444} y2={54} label={L.notify} labelDy={-7} />
    <Box x={444} y={30} w={124} h={48} label={L.deciders} sub={L.decidersSub} fill={BLUE_SOFT} stroke={BLUE} color={BLUE} />
    <Arrow x1={568} y1={54} x2={672} y2={54} color={GREEN} label={L.decision} labelDy={-7} />
    <Box x={672} y={30} w={80} h={48} label={L.answer} sub={L.answerSub} fill="#E6F2EB" stroke={GREEN} color={GREEN} size={11} />
  </Svg>
);

/* ── 7. Unity Catalog ⇄ Alassio: scheduled sync one way, write-back the other ── */
export const FigUcSync = ({ L }) => (
  <Svg w={780} h={160} title={L.title} note={L.note}>
    <Box x={10} y={44} w={200} h={96} label="Databricks Unity Catalog" sub={L.ucSub} fill={BLUE_SOFT} stroke={BLUE} color={BLUE} bold />
    <Box x={570} y={44} w={200} h={96} label="Alassio Data Catalog" sub={L.cortexSub} fill={BRAND_SOFT} stroke={BRAND} color={BRAND} bold />
    <Box x={290} y={4} w={200} h={24} label={L.profile} fill="#fff" stroke={LINE} color={MUTED} size={10.5} />
    <Arrow x1={390} y1={28} x2={390} y2={56} dashed />
    <Arrow x1={210} y1={72} x2={570} y2={72} color={BLUE} label={L.sync} labelDy={-6} />
    <text x={390} y={88} textAnchor="middle" fontSize="9.5" fill={MUTED} style={F}>{L.syncSub}</text>
    <Arrow x1={570} y1={118} x2={210} y2={118} color={BRAND} label={L.writeBack} labelDy={-6} />
    <text x={390} y={134} textAnchor="middle" fontSize="9.5" fill={MUTED} style={F}>{L.writeBackSub}</text>
  </Svg>
);

/* ── 8. AI agents: client → credential → MCP server → catalog/OKF ── */
export const FigAgents = ({ L }) => (
  <Svg w={720} h={160} title={L.title} note={L.credNote}>
    <Box x={10} y={52} w={130} h={56} label={L.client} sub="Claude · IDE · Agent" fill={BLUE_SOFT} stroke={BLUE} color={BLUE} />
    <Arrow x1={140} y1={80} x2={236} y2={80} label="HTTPS /mcp" labelDy={-7} />
    <Box x={236} y={14} w={210} h={30} label={L.oauth} fill="#fff" stroke={LINE} color={MUTED} size={10.5} />
    <Box x={236} y={65} w={210} h={30} label={L.agentKey} fill="#fff" stroke={LINE} color={MUTED} size={10.5} />
    <Box x={236} y={116} w={210} h={30} label={L.forwarded} fill="#fff" stroke={LINE} color={MUTED} size={10.5} />
    <Arrow x1={446} y1={80} x2={500} y2={80} />
    <Box x={500} y={52} w={96} h={56} label="MCP" sub={L.tools} fill={BRAND_SOFT} stroke={BRAND} color={BRAND} bold />
    <Arrow x1={596} y1={80} x2={626} y2={80} />
    <Box x={626} y={38} w={84} h={36} label={L.catalog} size={11} />
    <Box x={626} y={86} w={84} h={36} label="OKF" sub={L.okfSub} size={11} />
  </Svg>
);

export const FIGURES = { hierarchy: FigHierarchy, layers: FigLayers, ownership: FigOwnership, lineage: FigLineage, workflow: FigWorkflow, access: FigAccess, ucsync: FigUcSync, agents: FigAgents };
