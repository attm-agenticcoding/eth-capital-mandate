import { auto, hist } from '../lib/data.js';
import { PanelHead, Stat } from './ui.jsx';
import { fmtUsd } from '../lib/format.js';
import { alignmentDivergenceTrend } from '../lib/market.mjs';

const PAL = ['#62d2a2', '#e8634a', '#9b7ad6', '#e8b339', '#7aa2d6', '#4a9e8e', '#cc7766', '#556677'];

// A6: broad vs strict Ethereum-aligned share + a widening-gap divergence note. A growing
// broad−strict gap = ETH's headline share increasingly carried by the weakest-alignment chains.
function AlignmentDivergence({ broad, strict, gap, gapField, label }) {
  if (broad == null || strict == null) return null;
  const { widenedPp } = alignmentDivergenceTrend(gap, hist, gapField);
  return (
    <div className="align-div">
      <span className="ad-pair">{label}: <b>{broad}%</b> broad · <b>{strict}%</b> strict</span>
      <span className={`ad-gap${gap >= 5 ? ' wide' : ''}`}>Δ {gap}pp</span>
      {widenedPp != null && widenedPp > 0 && (
        <span className="ad-widen">⚠ gap widening +{widenedPp}pp since tracking — share carried by weakest-alignment chains</span>
      )}
    </div>
  );
}

function ShareList({ rows }) {
  return (
    <div className="sharelist">
      {rows.map((r, i) => (
        <div key={i} className="share-row">
          <span className="sl-dot" style={{ background: PAL[i % PAL.length] }} />
          <span className="sl-name">{r.name}</span>
          <span className="sl-bar"><span style={{ width: `${Math.min(100, r.sharePct)}%`, background: PAL[i % PAL.length] }} /></span>
          <span className="sl-pct">{r.sharePct}%</span>
        </div>
      ))}
    </div>
  );
}

export function ContextPanel() {
  const st = auto.stablecoins || {};
  const rwa = auto.rwa || {};
  const ch = auto.chains || {};
  const solStable = (st.byChain || []).find((c) => c.name === 'Solana')?.sharePct;

  return (
    <section className="panel">
      <PanelHead title="Context" sub="Where the capital stock actually sits — and the main competitor benchmark (Solana)" />
      <div className="context-grid">

        <div className="ctx-card">
          <div className="ctx-h">Stablecoin supply by chain <span className="muted">{fmtUsd(st.totalUsd)} total</span></div>
          <ShareList rows={st.byChain || []} />
          <AlignmentDivergence label="ETH-aligned (KC-2)" broad={st.ethAlignedSharePctBroad} strict={st.ethAlignedSharePctStrict} gap={st.ethAlignedBroadMinusStrictPp} gapField="stablecoinAlignedGapPp" />
          <p className="bear-note">⚠ Pair with take-rate (Bear panel): high share ≠ L1 revenue. Ethereum hosts {st.ethSharePct}% of stablecoin supply yet captures ≈0% take. KC-2 scores the <b>broad</b> set; the <b>strict</b> set (Polygon PoS + external-DA rollups excluded) shows how much of the headline rests on the weakest-alignment chains.</p>
        </div>

        <div className="ctx-card">
          <div className="ctx-h">RWA value by chain <span className="muted">{fmtUsd(rwa.totalUsd)} total</span></div>
          <ShareList rows={rwa.byChain || []} />
          <AlignmentDivergence label="ETH-aligned (KC-3)" broad={rwa.ethAlignedSharePctBroad} strict={rwa.ethAlignedSharePctStrict} gap={rwa.ethAlignedBroadMinusStrictPp} gapField="rwaAlignedGapPp" />
          <p className="bear-note">Ethereum mainnet share of tokenized real-world assets: {rwa.ethSharePct}% (KC-3 scores this stock share).</p>
        </div>

        <div className="ctx-card">
          <div className="ctx-h">Solana — competitor capital-stock benchmark</div>
          <div className="stat-row">
            <Stat label="Solana DeFi TVL" value={fmtUsd(ch.solanaTvl)} sub={`${ch.solanaSharePct}% of all chains`} />
            <Stat label="Ethereum DeFi TVL" value={fmtUsd(ch.ethTvl)} sub={`${ch.ethSharePct}% of all chains`} />
          </div>
          <div className="stat-row">
            <Stat label="Solana stablecoins" value={solStable != null ? `${solStable}%` : '—'} sub="of supply" />
            <Stat label="ETH : SOL DeFi TVL" value={ch.solanaTvl ? `${(ch.ethTvl / ch.solanaTvl).toFixed(1)}×` : '—'} />
          </div>
        </div>

      </div>
    </section>
  );
}
