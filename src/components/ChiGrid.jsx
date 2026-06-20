import { chi, auto, hist, manual, generatedUtc } from '../lib/data.js';
import { fmtScore } from '../lib/format.js';
import { Stamp } from './Stamp.jsx';
import { Sparkline } from './charts.jsx';
import { PanelHead } from './ui.jsx';

// Auto components get a sparkline of their underlying metric (rich from day 1);
// the rest fall back to their score history (accrues over time).
const UNDERLYING = {
  chi1: (auto.collateral?.drift || []).map((d) => ({ t: d.t, v: d.ethPct })),
  chi5: auto.vol?.series || [],
};
const SPARK_COLOR = { chi1: '#62d2a2', chi5: '#e8b339' };
const STALE = {
  chi1: auto.collateral?.stale,
  chi3: auto.restaking?.stale,
  chi5: auto._market?.stale,
};
const manualUpdated = manual._updated ? new Date(manual._updated).toISOString() : null;

const scoreColor = (s) => (s >= 1 ? '#62d2a2' : s >= 0.5 ? '#e8b339' : '#5b6675');

function Meter({ score }) {
  return (
    <div className="meter">
      <div className="meter-fill" style={{ width: `${Math.max(score, 0.02) * 100}%`, background: scoreColor(score) }} />
      <span className="meter-tick" style={{ left: '50%' }} />
      <span className="meter-tick" style={{ left: '100%' }} />
    </div>
  );
}

function ChiCard({ c }) {
  const isManual = c.mode === 'manual';
  let series = UNDERLYING[c.key];
  if (!series || series.length < 2) series = hist.map((r) => ({ t: r.t, v: r.scores?.[c.key] })).filter((d) => d.v != null);

  return (
    <div className={`chi-card${c.reverse ? ' reverse' : ''}`}>
      <div className="chi-card-head">
        <span className="chi-id">{c.id}</span>
        <span className="chi-name">{c.name}</span>
        <span className="chi-score-badge" style={{ color: scoreColor(c.score), borderColor: scoreColor(c.score) }}>{c.score}</span>
      </div>
      <Meter score={c.score} />
      <div className={`chi-value${c.lit ? ' lit' : ''}`}>{c.valueText}</div>
      {c.stressActive && <div className="stress-live" title="A ≥50% ETH drawdown is in progress and the auto collateral leg already carries a signal — this is a live soft-fail below the neutral seed, not a future hypothetical.">⚠ stress test ACTIVE — live soft-fail, no-delist check pending</div>}
      {c.feedBroken && <div className="feed-broken" title="An upstream sub-feed failed — this is a broken feed, not data still accruing.">⚠ feed broken — not accruing</div>}
      {series && series.length >= 2 ? (
        <div className="chi-spark"><Sparkline data={series} color={SPARK_COLOR[c.key] || scoreColor(c.score)} /></div>
      ) : (
        <div className="chi-spark muted small">score logged each refresh · sparkline builds over time</div>
      )}
      <div className="chi-detail">{c.detail}</div>
      <details className="chi-threshold"><summary>light-up threshold</summary><p>{c.threshold}</p></details>
      <Stamp source={c.source} asOf={isManual ? manualUpdated : generatedUtc} stale={isManual ? false : !!STALE[c.key]} mode={c.mode} />
    </div>
  );
}

function ProbMap() {
  const t = chi.total, rev = chi.reverseLit;
  const active = t >= 2.5 ? 'on' : t >= 1.5 ? 'hard' : t <= 0.5 && rev ? 'dead' : 'base';
  const rows = [
    { k: 'on', cond: 'CHI ≥ 2.5', branch: '53%', p10: '45%', p20: '22%', status: 'On track' },
    { k: 'hard', cond: 'CHI ≥ 1.5', branch: '42%', p10: '38%', p20: '17%', status: 'Hardening' },
    { k: 'base', cond: 'else', branch: '32%', p10: '30%', p20: '12%', status: 'Stalled / awaiting' },
    { k: 'dead', cond: 'CHI ≤ 0.5 + CHI-3 reverse lit', branch: '25%', p10: '—', p20: '—', status: 'Schelling RETIRED' },
  ];
  return (
    <div className="probmap">
      <div className="probmap-title">
        CHI → probability mapping <span className="muted">· live: CHI {fmtScore(t)} → <b>{rows.find((r) => r.k === active).status}</b></span>
      </div>
      <table>
        <thead><tr><th>Band</th><th>Mandate branch</th><th>P($10k)</th><th>P($20k)</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k} className={r.k === active ? 'active' : ''}>
              <td>{r.cond}</td><td>{r.branch}</td><td>{r.p10}</td><td>{r.p20}</td><td>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChiGrid() {
  return (
    <section className="panel">
      <PanelHead title="Convention Hardening Index" sub="Factory #1 — market convention · 3 auto-scored components, each 0 / 0.5 / 1 · max 3" />
      <div className="chi-grid">
        {chi.components.map((c) => <ChiCard key={c.id} c={c} />)}
      </div>
      {chi.unscored?.length > 0 && (
        <div className="chi-unscored">
          <div className="chi-unscored-h muted">Demoted to unscored watch (experiment) — does not move the index:</div>
          {chi.unscored.map((c) => (
            <div key={c.id} className="chi-card unscored">
              <div className="chi-card-head">
                <span className="chi-id">{c.id}</span>
                <span className="chi-name">{c.name}</span>
                <span className="chi-score-badge muted" style={{ borderColor: '#3a4453' }}>unscored</span>
              </div>
              <div className="chi-value">{c.valueText}</div>
              <div className="chi-detail">{c.detail}</div>
            </div>
          ))}
        </div>
      )}
      <p className="chi-note muted">
        Numbering keeps the original IDs. <b>CHI-2</b> (demand-side enforcement) and <b>CHI-6</b> (duration) were
        retired — CHI-2's signal is already in CHI-1's net ETH-vs-stable collateral drift, and a fixed-term ETH-credit
        market barely exists on-chain (&lt;$5M vs ~$13.5B variable-rate) with no keyless feed. <b>CHI-4</b>
        (institutional collateral) is an unscored, user-fed milestone — tracked in <b>Factory watch</b> below, not in the index.
      </p>
      <ProbMap />
    </section>
  );
}
