/* Lightweight inline SVG icon set */
const Ico = ({ d, size = 16, stroke = 1.6, fill = "none", children }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
    {d ? <path d={d} /> : children}
  </svg>
);

const Icons = {
  Dash: (p) => <Ico {...p}><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></Ico>,
  In:   (p) => <Ico {...p}><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><rect x="3" y="17" width="18" height="4" rx="1.5"/></Ico>,
  Out:  (p) => <Ico {...p}><path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><rect x="3" y="17" width="18" height="4" rx="1.5"/></Ico>,
  Box:  (p) => <Ico {...p}><path d="M3 7l9 4 9-4"/><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M12 11v10"/></Ico>,
  Map:  (p) => <Ico {...p}><path d="M9 4 3 7v13l6-3 6 3 6-3V4l-6 3-6-3z"/><path d="M9 4v13"/><path d="M15 7v13"/></Ico>,
  Tag:  (p) => <Ico {...p}><path d="M3 12V4a1 1 0 0 1 1-1h8l8 8-9 9-8-8z"/><circle cx="8" cy="8" r="1.3"/></Ico>,
  Print:(p) => <Ico {...p}><path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="9" rx="2"/><rect x="7" y="15" width="10" height="6"/></Ico>,
  Scan: (p) => <Ico {...p}><path d="M4 7V5a1 1 0 0 1 1-1h2"/><path d="M20 7V5a1 1 0 0 0-1-1h-2"/><path d="M4 17v2a1 1 0 0 0 1 1h2"/><path d="M20 17v2a1 1 0 0 1-1 1h-2"/><path d="M7 12h10"/></Ico>,
  Search:(p)=> <Ico {...p}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></Ico>,
  Plus: (p) => <Ico {...p}><path d="M12 5v14M5 12h14"/></Ico>,
  X:    (p) => <Ico {...p}><path d="M6 6l12 12M18 6 6 18"/></Ico>,
  Chev: (p) => <Ico {...p}><path d="m9 6 6 6-6 6"/></Ico>,
  Down: (p) => <Ico {...p}><path d="m6 9 6 6 6-6"/></Ico>,
  Up:   (p) => <Ico {...p}><path d="m6 15 6-6 6 6"/></Ico>,
  Filter:(p)=> <Ico {...p}><path d="M3 5h18M6 12h12M10 19h4"/></Ico>,
  Bell: (p) => <Ico {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 21a2 2 0 0 0 4 0"/></Ico>,
  Truck:(p) => <Ico {...p}><rect x="1" y="6" width="14" height="10" rx="1"/><path d="M15 9h4l3 3v4h-7"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></Ico>,
  Check:(p) => <Ico {...p}><path d="M4 12l5 5 11-11"/></Ico>,
  Dot:  (p) => <Ico {...p}><circle cx="12" cy="12" r="3" fill="currentColor"/></Ico>,
  Edit: (p) => <Ico {...p}><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="m13 7 4 4"/></Ico>,
  Trash:(p) => <Ico {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></Ico>,
  Copy: (p) => <Ico {...p}><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/></Ico>,
  Eye:  (p) => <Ico {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></Ico>,
  Refresh:(p)=><Ico {...p}><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></Ico>,
  Phone:(p) => <Ico {...p}><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/></Ico>,
  Calendar:(p)=><Ico {...p}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></Ico>,
  Warn: (p) => <Ico {...p}><path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18v.5"/></Ico>,
  Pkg:  (p) => <Ico {...p}><path d="m3 7 9 4 9-4M3 7l9-4 9 4M3 7v10l9 4M21 7v10l-9 4M8 5l8 4"/></Ico>,
  Setting:(p)=><Ico {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.65 1.65 0 0 0-1.8-.3 1.65 1.65 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.65 1.65 0 0 0-1-1.5 1.65 1.65 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.65 1.65 0 0 0 .3-1.8 1.65 1.65 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.65 1.65 0 0 0 1.5-1 1.65 1.65 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.65 1.65 0 0 0 1.8.3H9a1.65 1.65 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.65 1.65 0 0 0 1 1.5 1.65 1.65 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.65 1.65 0 0 0-.3 1.8V9a1.65 1.65 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.65 1.65 0 0 0-1.5 1z"/></Ico>,
  Help: (p) => <Ico {...p}><circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></Ico>,
  Door: (p) => <Ico {...p}><path d="M4 21h16M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/><circle cx="15" cy="13" r="0.7" fill="currentColor"/></Ico>,
  ArrowRight:(p)=><Ico {...p}><path d="M5 12h14M13 6l6 6-6 6"/></Ico>,
  History:(p)=><Ico {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></Ico>,
  Bundle:(p)=><Ico {...p}><rect x="2" y="7" width="9" height="9" rx="1.5"/><rect x="13" y="7" width="9" height="9" rx="1.5"/><path d="M7 7V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v3"/><path d="M7 12h10"/></Ico>,
  Cart:  (p)=><Ico {...p}><path d="M3 3h2l.4 2M7 13h10l4-8H5.4"/><circle cx="9" cy="19" r="1.5"/><circle cx="18" cy="19" r="1.5"/></Ico>,
  Camera:(p)=><Ico {...p}><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></Ico>,
  Spark:(p)=><Ico {...p}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18 14l.8 2.2 2.2.8-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z"/></Ico>,
  Lock: (p) => <Ico {...p}><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></Ico>,
};

/* Barcode (Code128-ish visual) */
const Barcode = ({ value = "TH8842919012", height = 48, scale = 1 }) => {
  const widths = [];
  let seed = 0;
  for (let i = 0; i < value.length; i++) seed = (seed * 31 + value.charCodeAt(i)) >>> 0;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff; };
  const bars = [];
  let x = 0;
  // start guard
  bars.push({ x, w: 1.5*scale, fill: true }); x += 1.5*scale;
  bars.push({ x, w: 1.5*scale, fill: false }); x += 1.5*scale;
  for (let i = 0; i < 70; i++) {
    const w = (rng() < 0.5 ? 1 : rng() < 0.5 ? 2 : 3) * scale;
    bars.push({ x, w, fill: i % 2 === 0 }); x += w;
  }
  bars.push({ x, w: 1.5*scale, fill: true }); x += 1.5*scale;
  bars.push({ x, w: 0.5*scale, fill: false }); x += 0.5*scale;
  bars.push({ x, w: 1.5*scale, fill: true }); x += 1.5*scale;
  return (
    <svg width={x} height={height} viewBox={`0 0 ${x} ${height}`}>
      {bars.filter(b => b.fill).map((b, i) => (
        <rect key={i} x={b.x} y="0" width={b.w} height={height} fill="#111"/>
      ))}
    </svg>
  );
};

/* Real, scannable QR via the qrcode-generator UMD lib (global `qrcode`).
   Returns { n, darks:[[col,row],...] } or null if the encoder isn't available. */
function qrModules(value) {
  if (typeof qrcode !== "function") return null;
  try {
    const qr = qrcode(0, "M");          // type 0 = auto-fit smallest version, ECC level M
    qr.addData(String(value == null ? "" : value));
    qr.make();
    const n = qr.getModuleCount();
    const darks = [];
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (qr.isDark(r, c)) darks.push([c, r]);
    return { n, darks };
  } catch (e) { return null; }
}

/* QR as a standalone SVG markup string — for print windows / new tabs where
   React isn't running. Same modules as the <QR> component. */
function qrSvgMarkup(value, size = 480) {
  const m = qrModules(value);
  let inner = "";
  if (m) {
    const cell = size / m.n;
    m.darks.forEach(([x, y]) => {
      inner += `<rect x="${(x * cell).toFixed(2)}" y="${(y * cell).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="#111"/>`;
    });
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" fill="white"/>${inner}</svg>`;
}

const QR = ({ value = "X", size = 72 }) => {
  const m = qrModules(value);
  if (!m) {
    // Encoder not loaded — render a neutral placeholder rather than a fake code.
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
        <rect width={size} height={size} fill="white"/>
        <rect x={size*0.3} y={size*0.44} width={size*0.4} height={size*0.12} fill="#ccc"/>
      </svg>
    );
  }
  const cell = size / m.n;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="white"/>
      {m.darks.map(([x,y], i) => <rect key={i} x={x*cell} y={y*cell} width={cell} height={cell} fill="#111"/>)}
    </svg>
  );
};

Object.assign(window, { Icons, Barcode, QR, qrModules, qrSvgMarkup });
