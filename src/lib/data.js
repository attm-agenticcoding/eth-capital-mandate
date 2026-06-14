// Single import point for the snapshot. The UI recomputes the CHI live from
// auto + manual (same engine fetch.mjs uses) so editing manual.json and rebuilding
// reflects immediately, even without a fresh fetch.
import latest from '../../data/latest.json';
import history from '../../data/history.json';
import { computeCHI, STATED_PRIOR } from './chi.mjs';

export const snapshot = latest;
export const auto = latest.auto || {};
export const manual = latest.manual || {};
export const meta = latest.meta || {};
export const generatedUtc = latest.generatedUtc;
export const hist = Array.isArray(history) ? history : [];
export const chi = computeCHI(latest);
export const prior = STATED_PRIOR;
export const sourceByKey = Object.fromEntries((meta.sources || []).map((s) => [s.key, s]));
