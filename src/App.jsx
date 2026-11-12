import snapshot from '../data/latest.json';
import history from '../data/history.json';
import signalState from '../data/signals.json';
import signalConfig from '../config/signals.json';
import { buildEvidence } from './lib/evidence.mjs';
import { describeSignals } from './lib/signals.mjs';
import { EvidenceDashboard } from './components/EvidenceDashboard.jsx';
import './index.css';

const evidence = buildEvidence(snapshot, history, { asOf: new Date().toISOString() });
const signals = describeSignals(signalState, signalConfig);

export default function App() {
  return <EvidenceDashboard evidence={evidence} signals={signals} />;
}
