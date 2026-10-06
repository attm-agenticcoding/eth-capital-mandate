import snapshot from '../data/latest.json';
import history from '../data/history.json';
import { buildEvidence } from './lib/evidence.mjs';
import { EvidenceDashboard } from './components/EvidenceDashboard.jsx';
import './index.css';

const evidence = buildEvidence(snapshot, history, { asOf: new Date().toISOString() });

export default function App() {
  return <EvidenceDashboard evidence={evidence} />;
}
