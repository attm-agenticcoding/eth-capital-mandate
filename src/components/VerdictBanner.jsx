import { chi, auto, prior } from '../lib/data.js';
import { fmtUsd } from '../lib/format.js';

function Prob({ label, v }) {
  return (
    <div className="prob">
      <div className="prob-v">{v == null ? '—' : `${v}%`}</div>
      <div className="prob-l">{label}</div>
    </div>
  );
}

export function VerdictBanner() {
  const p = chi.probabilities;
  const eth = auto.eth || {};
  const price = eth.price;
  const ratio = auto.ratio?.now;
  const [lo, hi] = prior.fairValueBandUsd;
  const trackLo = lo * 0.6, trackHi = hi * 1.6;
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const pos = price != null ? clamp((price - trackLo) / (trackHi - trackLo)) : 0;
  const bandL = clamp((lo - trackLo) / (trackHi - trackLo));
  const bandR = clamp((hi - trackLo) / (trackHi - trackLo));

  return (
    <section className={`verdict tone-${p.tone}`}>
      <div className="verdict-left">
        <div className="chi-score">
          <div className="chi-num">{chi.total.toFixed(1)}<span className="chi-den">/6</span></div>
          <div className="chi-lit">{chi.litCount} of 6 components lit&nbsp;(≥0.5)</div>
        </div>
        <div className="verdict-status">
          <div className={`status-pill tone-${p.tone}`}>{p.label || p.status}</div>
          <div className="verdict-probs">
            <Prob label="Mandate branch" v={p.branchPct} />
            <Prob label="P($10k by ’30)" v={p.p10k} />
            <Prob label="P($20k)" v={p.p20k} />
          </div>
          <div className="prior-note">▲ a stated analyst prior, not a model output</div>
        </div>
      </div>

      <div className="verdict-gauge">
        <div className="gauge-head">
          <span className="eth-price">Ξ&nbsp;{fmtUsd(price, 0)}</span>
          <span className="eth-ratio">ETH/BTC&nbsp;{ratio != null ? ratio.toFixed(5) : '—'}</span>
          <span className="eth-dd">{eth.athChangePct != null ? `${eth.athChangePct}% from ATH` : ''}</span>
        </div>
        <div className="gauge-track">
          <div className="gauge-band" style={{ left: `${bandL * 100}%`, width: `${(bandR - bandL) * 100}%` }} />
          <div className="gauge-marker" style={{ left: `${pos * 100}%` }} title={`ETH ${fmtUsd(price, 0)}`} />
        </div>
        <div className="gauge-labels">
          <span>↓ thesis more false</span>
          <span className="gauge-band-label">thesis-FALSE band ${lo.toLocaleString()}–${hi.toLocaleString()}/coin</span>
          <span>market prices mandate ↑</span>
        </div>
      </div>
    </section>
  );
}
