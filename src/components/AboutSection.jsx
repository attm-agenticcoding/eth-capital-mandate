export function AboutSection() {
  return (
    <details className="about">
      <summary>About — the one thesis this dashboard tracks</summary>
      <div className="about-body">
        <p>
          <b>One thesis, tested early.</b> ETH's only durable value channel is becoming the{' '}
          <b>capital stock of open on-chain finance</b> — native, non-freezable, slashable, yield-bearing
          collateral — <b>not</b> transaction fees.
        </p>
        <p>
          <b>Where the market sits.</b> Thesis-FALSE fair value ≈ <b>$1,200–2,500/coin</b> (≈ $0.15–0.30T mcap).
          ETH today sits mid-band → the market currently prices this thesis as <b>FALSE</b>. This dashboard exists
          {/* mcap = per-coin band × circulating supply (~120.7M ETH) */}
          to detect, <i>early</i>, whether the capital-mandate branch is hardening.
        </p>
        <p>
          <b>Three “factories”</b> can supply the missing mandate: (1) market convention [= the{' '}
          <b>Convention Hardening Index</b>], (2) regulatory codification, (3) protocol value-routing. All three
          are tracked below.
        </p>
        <p className="about-prior">
          <b>Probability prior</b> (a stated analyst prior, <i>not</i> a model output): base case = mandate branch
          32%, P(ETH touches $10k by end-2030) = 30%, P($20k) = 12%. These move only with the CHI score, per the
          mapping table.
        </p>
      </div>
    </details>
  );
}
