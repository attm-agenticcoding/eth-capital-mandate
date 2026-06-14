import { AboutSection } from './components/AboutSection.jsx';
import { VerdictBanner } from './components/VerdictBanner.jsx';
import { ChiGrid } from './components/ChiGrid.jsx';
import { FactoryWatch } from './components/FactoryWatch.jsx';
import { BearPanel } from './components/BearPanel.jsx';
import { ContextPanel } from './components/ContextPanel.jsx';
import { generatedUtc, meta } from './lib/data.js';
import { fmtUtc, timeAgo } from './lib/format.js';

export default function App() {
  const okCount = (meta.sources || []).filter((s) => s.ok).length;
  const total = (meta.sources || []).length;
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">Ξ</span>
          <div>
            <div className="brand-title">ETH Capital-Mandate Tracker</div>
            <div className="brand-sub">Convention Hardening Index · is ETH becoming the capital stock of on-chain finance?</div>
          </div>
        </div>
        <div className="topbar-meta">
          <span className={`src-health ${okCount < total ? 'warn' : 'ok'}`}>{okCount}/{total} sources live</span>
          <span className="updated" title={fmtUtc(generatedUtc)}>updated {timeAgo(generatedUtc)}</span>
        </div>
      </header>

      <AboutSection />
      <VerdictBanner />
      <ChiGrid />
      <FactoryWatch />
      <BearPanel />
      <ContextPanel />

      <footer className="footer">
        <p className="disclaimer"><b>Probabilities are a stated analyst prior, not a model output. Not investment advice.</b></p>
        <p className="muted">
          Auto metrics refresh every 6h via GitHub Actions — the commit log is the longitudinal record. Manual,
          thesis-critical components (CHI-2/3/4/6 and the factory cards) are human-curated and do not move on their own.
          Sources: CoinGecko · DefiLlama · ultrasound.money · growthepie · L2BEAT. Snapshot {fmtUtc(generatedUtc)}.
        </p>
      </footer>
    </div>
  );
}
