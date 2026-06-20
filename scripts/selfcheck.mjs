// scripts/selfcheck.mjs
//
// Verification harness for the pure scorers (src/lib/chi.mjs, src/lib/kill.mjs).
// Run: npm run selfcheck   (node --test scripts/selfcheck.mjs)
//
// Two layers:
//   1. CHARACTERIZATION — locks in the known-good baseline against the frozen
//      test/fixtures/current.json snapshot, so a regression in the scorers is caught.
//      When a deliberate fix changes the baseline (A2 lowers live CHI, etc.) these
//      assertions are updated IN THE SAME COMMIT and the new value is stated here.
//   2. BEHAVIOR — per-task fixtures describing the desired new behavior (A1..A7, B*).
//
// Pure scorers only — no network, no fetch. Fixtures are built from the frozen
// snapshot (clone + override) so time-relative cases derive their dates from Date.now().

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeCHI } from '../src/lib/chi.mjs';
import { computeKill } from '../src/lib/kill.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');

const readFixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

// The frozen characterization snapshot. Baseline statuses are independent of the
// longitudinal log (flow/persistence legs only sharpen watch/hit, never flip the
// baseline), so we pass an empty history for deterministic, time-stable assertions.
const current = readFixture('current.json');

const chiOf = (snap) => {
  const r = computeCHI(snap);
  r.byId = Object.fromEntries(r.components.map((c) => [c.id, c]));
  return r;
};
const killOf = (snap, hist = []) => {
  const r = computeKill(snap, hist);
  r.byId = Object.fromEntries(r.criteria.map((c) => [c.id, c]));
  return r;
};

// ====================================================================== BASELINE
// Known-good values at review time (see CLAUDE_CODE_TASKS.md "Known current state").
test('baseline · CHI total is 1.0 on the frozen snapshot', () => {
  assert.equal(chiOf(current).total, 1.0);
});

test('baseline · CHI component sub-scores (seed CHI-1 0.5, CHI-3 0.5, CHI-5 0)', () => {
  const { byId } = chiOf(current);
  assert.equal(byId['CHI-1'].score, 0.5);
  assert.equal(byId['CHI-3'].score, 0.5);
  assert.equal(byId['CHI-5'].score, 0);
});

test('baseline · no kill criteria are hit', () => {
  assert.equal(killOf(current).hitCount, 0);
});

test('baseline · kill statuses (KC-1 watch, KC-2/3/5/6 intact, KC-4/7 awaiting)', () => {
  const { byId } = killOf(current);
  assert.equal(byId['KC-1'].status, 'watch');
  assert.equal(byId['KC-2'].status, 'intact');
  assert.equal(byId['KC-3'].status, 'intact');
  assert.equal(byId['KC-4'].status, 'awaiting');
  assert.equal(byId['KC-5'].status, 'intact');
  assert.equal(byId['KC-6'].status, 'intact');
  assert.equal(byId['KC-7'].status, 'awaiting');
});

export { current, clone, readFixture, chiOf, killOf };
