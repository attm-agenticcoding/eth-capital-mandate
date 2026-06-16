import { kill, generatedUtc } from '../lib/data.js';
import { PanelHead } from './ui.jsx';
import { Stamp } from './Stamp.jsx';

const STATUS = {
  intact: 'intact',
  watch: 'on watch',
  hit: 'HIT',
  awaiting: 'awaiting',
};

function KillCard({ c }) {
  return (
    <div className={`chi-card kill-card kc-${c.status}`}>
      <div className="chi-card-head">
        <span className="chi-id">{c.id}</span>
        <span className="chi-name">{c.name}</span>
        <span className={`kc-pill kc-${c.status}`}>{STATUS[c.status] || c.status}</span>
      </div>
      <div className="chi-value lit">{c.valueText}</div>
      <div className="chi-detail">{c.detail}</div>
      <details className="chi-threshold"><summary>kill threshold</summary><p>{c.threshold}</p></details>
      <Stamp source={c.source} asOf={generatedUtc} mode={c.mode} />
    </div>
  );
}

function ExitBar() {
  const { hitCount, watchCount, awaitingCount, triggered, exitThreshold, criteria } = kill;
  const intactCount = criteria.length - hitCount - watchCount - awaitingCount;
  return (
    <div className={`kill-summary${triggered ? ' fired' : ''}`}>
      <div className="kill-count">
        <span className="kill-num">{hitCount}<span className="kill-den">/{exitThreshold}</span></span>
        <span className="kill-count-l">hits toward exit</span>
      </div>
      <div className="kill-legend">
        <div className="kill-pills">
          <span className="kc-pill kc-hit">{hitCount} hit</span>
          <span className="kc-pill kc-watch">{watchCount} on watch</span>
          <span className="kc-pill kc-intact">{intactCount} intact</span>
          {awaitingCount > 0 && <span className="kc-pill kc-awaiting">{awaitingCount} awaiting</span>}
        </div>
        <p className="kill-rule">
          {triggered
            ? '⚠ Exit rule TRIGGERED — ≥3 structural kill criteria are hit. Seriously consider exit.'
            : `Exit rule: ≥${exitThreshold} sustained hits over a 3–5yr window → seriously consider exit. These are structural falsifiers, not a price stop.`}
        </p>
      </div>
    </div>
  );
}

export function KillPanel() {
  return (
    <section className="panel">
      <PanelHead
        title="Kill criteria — structural falsification"
        sub={`7 disconfirming signals · exit rule: ≥${kill.exitThreshold} sustained hits over a 3–5yr window · clock anchored ${kill.clock}`}
      />
      <ExitBar />
      <div className="chi-grid kill-grid">
        {kill.criteria.map((c) => <KillCard key={c.id} c={c} />)}
      </div>
      <p className="chi-note muted">
        <b>Level</b> criteria (KC-2/3/5/6) hit on a threshold breach; <b>deadline</b> criteria (KC-1/4/7) only hit once
        their horizon elapses with the condition still true — a currently-true deadline condition is expected this early
        and shows <b>on watch</b>, not a hit. Persistence/flow legs (KC-3/5/6) accrue from the longitudinal log. Manual
        legs (KC-4 Stage&nbsp;2 + based sequencing, KC-5 governance, KC-7 formal verification) live in <b>manual.json</b>.
      </p>
    </section>
  );
}
