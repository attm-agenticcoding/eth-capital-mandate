// Dependency-free SVG charts. Kept tiny and theme-aware.

const valOf = (d) => (typeof d === 'number' ? d : d?.v);

export function Sparkline({ data = [], width = 132, height = 30, color = '#62d2a2', strokeWidth = 1.4 }) {
  const vals = data.map(valOf).filter((v) => v != null && isFinite(v));
  if (vals.length < 2) return <svg width={width} height={height} className="spark" />;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const X = (i) => (i / (vals.length - 1)) * width;
  const Y = (v) => height - ((v - min) / span) * (height - 3) - 1.5;
  const pts = vals.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const lx = X(vals.length - 1), ly = Y(vals[vals.length - 1]);
  const up = vals[vals.length - 1] >= vals[0];
  return (
    <svg width={width} height={height} className="spark" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="1.9" fill={color} />
    </svg>
  );
}

// Full-width trend chart. Reference lines + optional band drawn in SVG; their labels
// rendered as an HTML legend below to avoid non-uniform text scaling.
export function LineChart({
  data = [], height = 130, color = '#4a9ee8', yRefs = [], band = null,
  area = true, legend = true, yFormat = (v) => v, footer = null,
}) {
  const vals = data.map(valOf).filter((v) => v != null && isFinite(v));
  if (vals.length < 2) return <div className="chart-empty">awaiting history…</div>;
  const W = 600, H = height, pT = 10, pB = 8;
  const refVals = yRefs.map((r) => r.v);
  let min = Math.min(...vals, ...refVals, ...(band || []));
  let max = Math.max(...vals, ...refVals, ...(band || []));
  const pad = (max - min || 1) * 0.08;
  min -= pad; max += pad;
  const span = max - min || 1;
  const X = (i) => (i / (vals.length - 1)) * W;
  const Y = (v) => pT + (1 - (v - min) / span) * (H - pT - pB);
  const line = vals.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const areaPts = `0,${H - pB} ${line} ${W},${H - pB}`;
  const last = vals[vals.length - 1];
  return (
    <div className="lc">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" className="linechart">
        {band && (
          <rect x="0" y={Y(band[1])} width={W} height={Math.max(0, Y(band[0]) - Y(band[1]))} fill="#3a4a63" opacity="0.18" />
        )}
        {yRefs.map((r, i) => (
          <line key={i} x1="0" x2={W} y1={Y(r.v)} y2={Y(r.v)} stroke={r.color || '#e8634a'} strokeDasharray="5 4" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.7" />
        ))}
        {area && <polygon points={areaPts} fill={color} opacity="0.09" />}
        <polyline points={line} fill="none" stroke={color} strokeWidth="1.7" vectorEffect="non-scaling-stroke" />
        <circle cx={X(vals.length - 1)} cy={Y(last)} r="2.6" fill={color} />
      </svg>
      {legend && (yRefs.length > 0 || footer) && (
        <div className="lc-legend">
          <span className="lc-cur" style={{ color }}>now {yFormat(last)}</span>
          {yRefs.map((r, i) => (
            <span key={i} className="lc-ref" style={{ color: r.color || '#e8634a' }}>— {r.label}</span>
          ))}
          {footer && <span className="lc-foot">{footer}</span>}
        </div>
      )}
    </div>
  );
}

// Horizontal stacked composition bar (e.g. collateral buckets).
export function StackBar({ segments = [], height = 14 }) {
  const total = segments.reduce((a, s) => a + (s.value || 0), 0) || 1;
  return (
    <div className="stackbar" style={{ height }}>
      {segments.map((s, i) => (
        <div key={i} className="seg" title={`${s.label}: ${((s.value / total) * 100).toFixed(1)}%`}
          style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
      ))}
    </div>
  );
}
