import { auto } from '../lib/data.js';
import { PanelHead, Stat } from './ui.jsx';
import { LineChart, StackBar } from './charts.jsx';
import { fmtUsd, fmtSigned, fmtEth, fmtNum } from '../lib/format.js';

function barW(v, sup) {
  const max = Math.max(sup.issuance30dEth || 0, sup.burn30dEth || 0, 1);
  return Math.max(2, (Math.abs(v || 0) / max) * 100);
}

export function BearPanel() {
  const corr = auto.correlation?.now;
  const corrColor = corr == null ? '#8a97a8' : corr > 0.85 ? '#e8634a' : corr < 0.7 ? '#62d2a2' : '#e8b339';
  const corrVerdict =
    corr == null ? '—'
      : corr > 0.85 ? 'Still single-factor — the independent thesis is NOT priced'
      : corr < 0.7 ? 'Decoupling — thesis becoming priceable'
      : 'Loosening — watch for sustained < 0.70';
  const fees = auto.fees || {};
  const sup = auto.supply || {};
  const drift = auto.collateral?.drift || [];
  const d = drift.at(-1);

  return (
    <section className="panel">
      <PanelHead title="Bear-confirmation panel" sub="The disconfirming reads — is ETH still priced on BTC's single factor, and is L1 value capture still ≈ 0?" />
      <div className="bear-grid">

        <div className="bear-card wide">
          <div className="bear-h">ETH/BTC 90-day rolling correlation <span className="bear-now" style={{ color: corrColor }}>{corr != null ? corr.toFixed(3) : '—'}</span></div>
          <LineChart data={auto.correlation?.series || []} color="#7aa2d6" yFormat={(v) => v.toFixed(2)}
            yRefs={[{ v: 0.85, label: '0.85 single-factor', color: '#e8634a' }, { v: 0.7, label: '0.70 decoupling', color: '#62d2a2' }]} />
          <p className="bear-note">{corrVerdict}. &gt;0.85 = market prices ETH on BTC's beta (thesis isn't priced → can't be monetized); &lt;0.70 sustained = decoupling.</p>
        </div>

        <div className="bear-card">
          <div className="bear-h">L1 + blob fee revenue <span className="muted">· Dencun-damage line</span></div>
          <LineChart data={fees.l1PlusBlobSeries || []} color="#e8b339" yFormat={(v) => fmtUsd(v)} height={104} />
          <div className="stat-row">
            <Stat label="L1+blob / day (30d avg)" value={fmtUsd(fees.l1PlusBlob30dAvgUsd)} />
            <Stat label="L1 take-rate vs on-chain value" value={fees.takeRatePctPerYr != null ? `${fees.takeRatePctPerYr}%/yr` : '—'} tone="bad" />
          </div>
          <p className="bear-note">Paired with take-rate to avoid the “share up, revenue ≈ 0” trap. Blobs ≈ {fmtUsd(fees.blobRev30dAvgUsd)}/day — essentially free.</p>
        </div>

        <div className="bear-card">
          <div className="bear-h">Top-5 L2 paid-to-L1 ÷ L2 revenue</div>
          <LineChart data={fees.l2PaidToL1?.series || []} color="#7aa2d6" yFormat={(v) => `${v}%`}
            yRefs={[{ v: 20, label: '20% break (4q)', color: '#e8634a' }]} height={104} />
          <div className="stat-row">
            <Stat label="current" value={fees.l2PaidToL1?.currentRatioPct != null ? `${fees.l2PaidToL1.currentRatioPct}%` : '—'} />
            <Stat label="top-5 share" value={fees.l2PaidToL1?.top5RatioPct != null ? `${fees.l2PaidToL1.top5RatioPct}%` : '—'} sub={(fees.l2PaidToL1?.top5 || []).slice(0, 3).join(' · ')} />
          </div>
          <p className="bear-note">Settlement + DA costs L2s pay L1 ÷ L2 fee revenue (excl. MEV). Break = sustained &gt;20% for 4 quarters. Currently ≈ 0.</p>
        </div>

        <div className="bear-card">
          <div className="bear-h">Collateral drift <span className="bear-now" style={{ color: (auto.collateral?.combinedEthShareDeltaPp || 0) < 0 ? '#e8634a' : '#62d2a2' }}>{fmtSigned(auto.collateral?.combinedEthShareDeltaPp, 1)}pp</span></div>
          <LineChart data={drift.map((x) => ({ t: x.t, v: x.ethPct }))} color="#62d2a2" yFormat={(v) => `${v}%`} height={84} legend={false} />
          {d && (
            <div className="compbar-wrap">
              <StackBar segments={[
                { label: 'ETH-system', value: d.ethPct, color: '#62d2a2' },
                { label: 'Stable/RWA', value: d.stablePct, color: '#7aa2d6' },
                { label: 'BTC', value: d.btcPct, color: '#e8b339' },
                { label: 'Other', value: Math.max(0, 100 - d.ethPct - d.stablePct - d.btcPct), color: '#46525f' },
              ]} />
              <div className="compbar-legend">
                <span style={{ color: '#62d2a2' }}>ETH {d.ethPct}%</span>
                <span style={{ color: '#7aa2d6' }}>stable {d.stablePct}%</span>
                <span style={{ color: '#e8b339' }}>BTC {d.btcPct}%</span>
              </div>
            </div>
          )}
          <p className="bear-note">ETH-system vs tokenized-treasury / stablecoin share across Aave · Morpho · Sky.</p>
        </div>

        <div className="bear-card">
          <div className="bear-h">ETH staked & net issuance</div>
          <div className="stat-row">
            <Stat label="staked" value={sup.stakingPct != null ? `${sup.stakingPct}%` : '—'} sub={fmtEth(sup.stakedEth)} />
            <Stat label="net supply 30d" value={`${fmtSigned(sup.net30dEth)} ETH`} sub={sup.deflationary ? 'deflationary' : 'inflationary'} tone={sup.deflationary ? 'good' : 'bad'} />
          </div>
          <div className="issuance-bars">
            <div className="ib-row"><span className="ib-l">issuance 30d</span><span className="ib-bar iss" style={{ width: `${barW(sup.issuance30dEth, sup)}%` }} /><span className="ib-v">{fmtNum(sup.issuance30dEth)}</span></div>
            <div className="ib-row"><span className="ib-l">burn 30d</span><span className="ib-bar burn" style={{ width: `${barW(sup.burn30dEth, sup)}%` }} /><span className="ib-v">{fmtNum(sup.burn30dEth)}</span></div>
          </div>
          <p className="bear-note">Since Merge: {fmtSigned(sup.sinceMergeEth)} ETH — {sup.sinceMergeEth > 0 ? 'supply grew, NOT ultrasound' : 'deflationary'}. Burn collapsed post-Dencun.</p>
        </div>

      </div>
    </section>
  );
}
