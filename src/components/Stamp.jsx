import { fmtUtc, timeAgo } from '../lib/format.js';

export function Badge({ mode }) {
  const label = mode === 'manual' ? 'MANUAL' : mode === 'auto+manual' ? 'AUTO+MANUAL' : 'AUTO';
  const cls = mode === 'manual' ? 'badge manual' : mode === 'auto+manual' ? 'badge mixed' : 'badge auto';
  return <span className={cls} title={mode === 'manual' ? 'Human-curated — does NOT update on its own' : mode === 'auto+manual' ? 'Auto metric with a manual confirmation leg' : 'Auto-fetched from a public API'}>{label}</span>;
}

// Provenance stamp: source link + AUTO/MANUAL badge + UTC last-updated + stale flag.
export function Stamp({ source, asOf, stale, mode }) {
  return (
    <div className="stamp">
      {mode && <Badge mode={mode} />}
      {source?.url ? (
        <a href={source.url} target="_blank" rel="noreferrer" className="src">{source.label || 'source'} ↗</a>
      ) : (
        <span className="src muted">{source?.label || 'manual'}</span>
      )}
      <span className={`ts${stale ? ' stale' : ''}`} title={fmtUtc(asOf)}>
        {stale ? '⚠ stale · ' : ''}{timeAgo(asOf)}
      </span>
    </div>
  );
}
