import { chi, auto, hist, manual, generatedUtc } from '../lib/data.js';
import { Stamp } from './Stamp.jsx';
import { Sparkline } from './charts.jsx';
import { PanelHead } from './ui.jsx';

// Auto components get a sparkline of their underlying metric (rich from day 1);
// manual components fall back to their score history (accrues over time).
const UNDERLYING = {
  chi1: (auto.collateral?.drift || []).map((d) => ({ t: d.t, v: d.ethPct })),
  chi5: auto.vol?.series || [],
};
const SPARK_COLOR = { chi1: '#62d2a2', chi5: '#e8b339' };
const STALE = { chi1: auto.collateral?.stale, chi5: auto._market?.stale };
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
  const active = t >= 5 ? 'on' : t >= 3.5 ? 'hard' : t <= 1.5 && rev ? 'dead' : 'base';
  const rows = [
    { k: 'on', cond: 'CHI ≥ 5.0', branch: '53%', p10: '45%', p20: '22%', status: 'On track' },
    { k: 'hard', cond: 'CHI ≥ 3.5', branch: '42%', p10: '38%', p20: '17%', status: 'Hardening' },
    { k: 'base', cond: 'else', branch: '32%', p10: '30%', p20: '12%', status: 'Stalled / awaiting' },
    { k: 'dead', cond: 'CHI ≤ 1.5 + CHI-3 reverse lit', branch: '25%', p10: '—', p20: '—', status: 'Schelling RETIRED' },
  ];
  return (
    <div className="probmap">
      <div className="probmap-title">
        CHI → probability mapping <span className="muted">· live: CHI {t.toFixed(1)} → <b>{rows.find((r) => r.k === active).status}</b></span>
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
      <PanelHead title="Convention Hardening Index" sub="Factory #1 — market convention · 6 components, each 0 / 0.5 / 1 · max 6" />
      <div className="chi-grid">
        {chi.components.map((c) => <ChiCard key={c.id} c={c} />)}
      </div>
      <ProbMap />
    </section>
  );
}
