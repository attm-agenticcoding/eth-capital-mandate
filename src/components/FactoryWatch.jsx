import { manual } from '../lib/data.js';
import { PanelHead, Awaiting } from './ui.jsx';

const STAGES = ['idea', 'draft', 'cfi', 'scheduled', 'live'];

function StatusTrack({ status }) {
  const i = STAGES.indexOf(status);
  return (
    <div className="track">
      {STAGES.map((s, idx) => (
        <span key={s} className={`track-step${i >= 0 && idx <= i ? ' on' : ''}${s === 'scheduled' ? ' gate' : ''}`}>{s}</span>
      ))}
    </div>
  );
}

function ProtocolCard() {
  const items = (manual.factory_protocol?.items || []).filter(
    (it) => it && it.name && it.name !== 'blob-fee-floor|mev-burn|native-rollup-eth-bond');
  return (
    <div className="factory-card">
      <div className="factory-head">
        <span className="factory-title">Protocol value-routing</span>
        <span className="prior-chip">prior ≈ 25–30% by 2029</span>
      </div>
      <p className="factory-q">
        Has any of {'{'} blob base-fee floor / reserve price · MEV-burn (execution-tickets / ePBS) ·
        protocol-enforced ETH bond for native rollups {'}'} entered a <b>scheduled</b> hard fork?
      </p>
      {items.length === 0 ? (
        <Awaiting>
          Awaiting — no scheduled value-routing fork. Watching <b>EIP-7732 (ePBS)</b> as the rail: it doesn't
          route value itself, but is the track value-routing would run on.
        </Awaiting>
      ) : (
        <div className="factory-items">
          {items.map((it, i) => (
            <div key={i} className="factory-item">
              <div className="fi-head">
                <b>{it.name}</b>
                {it.eip && <span className="eip">{it.eip}</span>}
                {it.source && <a href={it.source} target="_blank" rel="noreferrer">src ↗</a>}
              </div>
              <StatusTrack status={it.status} />
              {it.fork && <span className="fork">fork: {it.fork}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CodificationCard() {
  const venues = (manual.chi4_institutional?.venues || []).filter((v) => v && v.name);
  return (
    <div className="factory-card">
      <div className="factory-head">
        <span className="factory-title">Codification depth</span>
        <span className="prior-chip">CHI-4 · unscored milestone</span>
      </div>
      <p className="factory-q">Regulated venues listing ETH on a collateral eligibility schedule — asset form, haircut, live date.</p>
      {venues.length === 0 ? (
        <Awaiting>Awaiting — no regulated venue (PB / CCP / margin) has listed ETH on a collateral schedule at haircut ≤40%, live.</Awaiting>
      ) : (
        <table className="codif">
          <thead><tr><th>Venue</th><th>Type</th><th>Asset</th><th>Haircut</th><th>Live</th></tr></thead>
          <tbody>
            {venues.map((v, i) => (
              <tr key={i}>
                <td>{v.source ? <a href={v.source} target="_blank" rel="noreferrer">{v.name} ↗</a> : v.name}</td>
                <td>{v.type}</td><td>{v.asset}</td>
                <td>{v.haircut_pct != null ? `${v.haircut_pct}%` : '—'}</td>
                <td>{v.live ? '✓' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function FactoryWatch() {
  return (
    <section className="panel">
      <PanelHead title="Factory watch" sub="Factories #2 (regulatory codification) & #3 (protocol value-routing) — human-curated; these do NOT move on their own" />
      <div className="factory-grid">
        <ProtocolCard />
        <CodificationCard />
      </div>
    </section>
  );
}
