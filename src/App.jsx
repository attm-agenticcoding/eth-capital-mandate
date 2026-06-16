import { AboutSection } from './components/AboutSection.jsx';
import { VerdictBanner } from './components/VerdictBanner.jsx';
import { ChiGrid } from './components/ChiGrid.jsx';
import { KillPanel } from './components/KillPanel.jsx';
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
      <KillPanel />
      <FactoryWatch />
      <BearPanel />
      <ContextPanel />

      <footer className="footer">
        <p className="disclaimer"><b>Probabilities are a stated analyst prior, not a model output. Not investment advice.</b></p>
        <p className="muted">
          The CHI is fully auto-scored (CHI-1/3/5) and refreshes every 6h via GitHub Actions — the commit log is the
          longitudinal record. CHI-1 keeps a manual stress-confirm leg; the institutional watch (CHI-4) and the factory
          cards are user-fed milestones that do not move the index. Sources: CoinGecko · DefiLlama · Morpho ·
          ultrasound.money · growthepie · L2BEAT. Snapshot {fmtUtc(generatedUtc)}.
        </p>
      </footer>
    </div>
  );
}
