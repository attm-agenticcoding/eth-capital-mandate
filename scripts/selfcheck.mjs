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
// Known-good values. CHI-1 0.5→0.25 and total 1.0→0.75 as of A2: the frozen snapshot is
// in a live ≥50% drawdown with collateral share down 7.6pp (>5pp), so CHI-1's stress-live
// soft-fail (0.25) replaces the neutral seed. CHI-3 0.5, CHI-5 0 unchanged.
test('baseline · CHI total is 0.75 on the frozen snapshot (A2 stress-live soft-fail)', () => {
  assert.equal(chiOf(current).total, 0.75);
});

test('baseline · CHI component sub-scores (CHI-1 0.25 live soft-fail, CHI-3 0.5, CHI-5 0)', () => {
  const { byId } = chiOf(current);
  assert.equal(byId['CHI-1'].score, 0.25);
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

// ====================================================================== A1
// CHI-5 haircut leg: a BROKEN feed must read distinctly from genuinely-accruing data.
const chi5DetailOf = (snap) => chiOf(snap).byId['CHI-5'].detail;

test('A1 · current snapshot is unchanged — CHI-5 still scores 0, reads "not compressing"', () => {
  const c = chiOf(current).byId['CHI-5'];
  assert.equal(c.score, 0);
  assert.match(c.detail, /not compressing/);
  assert.doesNotMatch(c.detail, /accruing|broken/);
});

test('A1a · failed feed → detail says broken/unavailable, NOT accruing', () => {
  const snap = clone(current);
  snap.auto.collateral.ethMaxLltvStatus = 'failed';
  snap.auto.collateral.ethMaxLltvPct = null;
  delete snap.auto.collateral.ethMaxLltvDeltaPp;
  const detail = chi5DetailOf(snap);
  assert.match(detail, /broken|unavailable/);
  assert.doesNotMatch(detail, /accruing/);
  const c = chiOf(snap).byId['CHI-5'];
  assert.equal(c.feedBroken, true); // flag surfaced for the UI
  assert.equal(c.score, 0); // distinction is detail-only; a dead leg never inflates the score
});

test('A1b · ok feed but single history point (delta null) → detail says accruing', () => {
  const snap = clone(current);
  snap.auto.collateral.ethMaxLltvStatus = 'ok';
  snap.auto.collateral.ethMaxLltvPct = 86;
  snap.auto.collateral.ethMaxLltvDeltaPp = null; // only one logged reading so far
  const detail = chi5DetailOf(snap);
  assert.match(detail, /accruing/);
  assert.doesNotMatch(detail, /broken|unavailable/);
  assert.equal(chiOf(snap).byId['CHI-5'].feedBroken, false);
});

test('A1c · stale carried feed → reads "stale", neither broken nor accruing nor compressing', () => {
  const snap = clone(current);
  snap.auto.collateral.ethMaxLltvStatus = 'stale';
  snap.auto.collateral.ethMaxLltvPct = 86;
  snap.auto.collateral.ethMaxLltvDeltaPp = 4; // even a >=1pp delta must NOT confirm on stale data
  const c = chiOf(snap).byId['CHI-5'];
  assert.match(c.detail, /stale/);
  assert.doesNotMatch(c.detail, /accruing|broken|confirmed/);
  assert.equal(c.score, 0);
});

// ====================================================================== A2
// CHI-1 must reflect the LIVE stress test, not hold the neutral seed mid-drawdown.
test('A2 · live ≥50% drawdown + share Δ ≤−5pp + manual unset → CHI-1 0.25 soft-fail', () => {
  const snap = clone(current);
  snap.auto.eth.drawdownFromPeakPct = 64.8;
  snap.auto.collateral.combinedEthShareDeltaPp = -6.2;
  snap.manual.chi1_stress = { episode_through_50dd: false, share_delta_pp: null, no_delist_or_ltv_cut: null };
  const c = chiOf(snap).byId['CHI-1'];
  assert.equal(c.score, 0.25);
  assert.ok(c.score < 0.5, 'invariant: live soft-fail strictly below the neutral seed');
  assert.equal(c.lit, false, 'a 0.25 soft-fail is not "lit"');
  assert.equal(c.stressActive, true);
  assert.match(c.detail, /stress test active/i);
  assert.match(c.detail, /pending no-delist/i);
});

test('A2 · live ≥50% drawdown but share holding (Δ > −5pp) → CHI-1 holds 0.5 under stress', () => {
  const snap = clone(current);
  snap.auto.eth.drawdownFromPeakPct = 60;
  snap.auto.collateral.combinedEthShareDeltaPp = -2;
  snap.manual.chi1_stress = { episode_through_50dd: false };
  const c = chiOf(snap).byId['CHI-1'];
  assert.equal(c.score, 0.5);
  assert.equal(c.stressActive, true);
  assert.match(c.detail, /holding under stress/i);
});

test('A2 · a RESOLVED episode overrides the live branch (operator-owned verdict wins)', () => {
  const snap = clone(current); // dd 62.7, Δ −7.6 → would be a live soft-fail
  snap.manual.chi1_stress = { episode_through_50dd: true, share_delta_pp: -3, no_delist_or_ltv_cut: true };
  const c = chiOf(snap).byId['CHI-1'];
  assert.equal(c.score, 1, 'resolved-survived overrides the live soft-fail');
  assert.equal(c.stressActive, false);
});

test('A2 · no live stress (dd < 50, manual unset) → CHI-1 holds the neutral seed 0.5', () => {
  const snap = clone(current);
  snap.auto.eth.drawdownFromPeakPct = 20;
  snap.auto.collateral.combinedEthShareDeltaPp = -8; // big drift but NOT in a ≥50% drawdown
  snap.manual.chi1_stress = { episode_through_50dd: false };
  const c = chiOf(snap).byId['CHI-1'];
  assert.equal(c.score, 0.5);
  assert.equal(c.stressActive, false);
  assert.match(c.detail, /seed 0\.5/i);
});

// ====================================================================== A5
// KC-6 must escalate to watch on the LEADING volume signal, not only the lagging TVL one.
test('A5 · TVL favors ETH but SOL DEX-volume share crosses ETH → KC-6 watch', () => {
  const snap = clone(current);
  snap.auto.chains.ethSharePct = 52.8;   // TVL share still ETH ≫ SOL
  snap.auto.chains.solanaSharePct = 6.6;
  snap.auto.chains.ethDexVolSharePct = 16.9; // …but volume share has flipped
  snap.auto.chains.solDexVolSharePct = 23.2;
  const c = killOf(snap).byId['KC-6'];
  assert.equal(c.status, 'watch');
  assert.equal(c.hit, false); // watch is NOT a hit — hitCount semantics unchanged
  assert.match(c.detail, /volume/i);
});

test('A5 · TVL favors ETH and volume still favors ETH → KC-6 intact', () => {
  const snap = clone(current);
  snap.auto.chains.ethSharePct = 52.8;
  snap.auto.chains.solanaSharePct = 6.6;
  snap.auto.chains.ethDexVolSharePct = 30;
  snap.auto.chains.solDexVolSharePct = 18;
  assert.equal(killOf(snap).byId['KC-6'].status, 'intact');
});

test('A5 · missing volume fields (feed down) → KC-6 falls back to TVL, no crash', () => {
  const snap = clone(current); // current.json predates the dex fields
  assert.equal(snap.auto.chains.ethDexVolSharePct, undefined);
  assert.equal(killOf(snap).byId['KC-6'].status, 'intact');
});

test('A5 · SOL overtakes ETH on TVL share → KC-6 hit (unchanged hit semantics)', () => {
  const snap = clone(current);
  snap.auto.chains.ethSharePct = 20;
  snap.auto.chains.solanaSharePct = 25;
  assert.equal(killOf(snap).byId['KC-6'].status, 'hit');
});

export { current, clone, readFixture, chiOf, killOf };
