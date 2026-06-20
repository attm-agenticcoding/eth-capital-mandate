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
import { drawdownPctFromAth, alignmentGapPp, alignmentDivergenceTrend } from '../src/lib/market.mjs';
import { ETH_ALIGNED_CHAINS, ETH_ALIGNED_CHAINS_STRICT, flowShareSinceOldest } from '../src/lib/kill.mjs';

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

// ====================================================================== A3
// Deadline criteria need a progressive `elevated` warning before the cliff. Clocks are
// derived from Date.now() so the fixtures stay valid as real time advances.
const clockYearsAgo = (y) => new Date(Date.now() - y * 365.25 * 86400 * 1000).toISOString().slice(0, 10);
const withClock = (iso) => {
  const snap = clone(current); // both KC-1 auto legs are already lit in current.json
  snap.manual.kill_criteria = { ...(snap.manual.kill_criteria || {}), thesis_clock_start: iso };
  return snap;
};

test('A3a · clock 3.2y ago, both legs lit → KC-1 elevated (past 60% of 5y)', () => {
  const c = killOf(withClock(clockYearsAgo(3.2))).byId['KC-1'];
  assert.equal(c.status, 'watch');
  assert.equal(c.elevated, true);
  assert.equal(c.hit, false);
  assert.match(c.detail, /elevated/i);
});

test('A3b · clock 1y ago, both legs lit → KC-1 plain watch (not elevated)', () => {
  const c = killOf(withClock(clockYearsAgo(1))).byId['KC-1'];
  assert.equal(c.status, 'watch');
  assert.equal(c.elevated, false);
});

test('A3 · baseline clock (~1.5y) → KC-1 plain watch, hitCount rule unchanged', () => {
  const k = killOf(current);
  assert.equal(k.byId['KC-1'].status, 'watch');
  assert.equal(k.byId['KC-1'].elevated, false);
  assert.equal(k.hitCount, 0);
});

test('A3 · elevated never counts as a hit (exit ≥3 rule intact)', () => {
  const snap = withClock(clockYearsAgo(4.9)); // deep into KC-1's 5y horizon but < 5y
  // neutralise the shorter-horizon deadline legs (KC-4 3y / KC-7 2y), which DO legitimately
  // hit once their horizons elapse, so only KC-1's elevated-watch is in play.
  snap.manual.kill_criteria.kc4_l2_reflow = { top_l2_stage2_and_based: true };
  snap.manual.kill_criteria.kc7_formal_verification = { material_progress: true };
  const k = killOf(snap);
  assert.equal(k.byId['KC-1'].elevated, true);
  assert.equal(k.byId['KC-1'].status, 'watch');
  assert.equal(k.byId['KC-1'].hit, false);
  assert.equal(k.hitCount, 0); // elevated KC-1 contributes nothing to the ≥3 exit rule
});

// ====================================================================== A4
// The CHI-1-facing drawdown is computed from the true ATH, not a rolling window max.
const r1 = (x) => Math.round(x * 10) / 10;
test('A4 · drawdown from true ATH matches the acceptance values', () => {
  assert.equal(r1(drawdownPctFromAth(1702.05, 4946.05)), 65.6); // review-time snapshot
  assert.equal(r1(drawdownPctFromAth(1800.62, 4946.05)), 63.6); // frozen-fixture price
});

test('A4 · drawdown is independent of any rolling window (ATH never hardcoded)', () => {
  // A flat price with the ATH outside a hypothetical window still reads the true drawdown.
  assert.equal(drawdownPctFromAth(4946.05, 4946.05), 0);
  assert.equal(r1(drawdownPctFromAth(2473.025, 4946.05)), 50.0);
});

test('A4 · bad inputs → null (never fabricate)', () => {
  assert.equal(drawdownPctFromAth(1700, 0), null);
  assert.equal(drawdownPctFromAth(null, 4946), null);
  assert.equal(drawdownPctFromAth(1700, undefined), null);
});

// ====================================================================== A6
// Strict + broad alignment shares are both exposed; KC-2/KC-3 SCORING is unchanged.
test('A6 · strict alignment set is a proper subset of broad (Polygon PoS etc. dropped)', () => {
  const broad = new Set(ETH_ALIGNED_CHAINS);
  assert.ok(ETH_ALIGNED_CHAINS_STRICT.every((c) => broad.has(c)));
  assert.ok(ETH_ALIGNED_CHAINS_STRICT.length < ETH_ALIGNED_CHAINS.length);
  for (const dropped of ['Polygon', 'Mantle', 'Manta', 'Metis', 'Fraxtal']) {
    assert.ok(!ETH_ALIGNED_CHAINS_STRICT.includes(dropped), `${dropped} excluded from strict`);
  }
});

test('A6 · alignmentGapPp = broad − strict, strict ≤ broad always', () => {
  assert.equal(alignmentGapPp(55.2, 49.0), 6.2);
  assert.equal(alignmentGapPp(50, 50), 0);
  assert.equal(alignmentGapPp(null, 49), null);
});

test('A6 · divergence trend flags a WIDENING gap from the log', () => {
  const histRows = [{ stablecoinAlignedGapPp: 4.0 }, { stablecoinAlignedGapPp: 5.0 }];
  const t = alignmentDivergenceTrend(7.5, histRows, 'stablecoinAlignedGapPp');
  assert.equal(t.gap, 7.5);
  assert.equal(t.widenedPp, 3.5); // 7.5 − oldest 4.0
  // no history yet → no false widening signal
  assert.equal(alignmentDivergenceTrend(7.5, [], 'stablecoinAlignedGapPp').widenedPp, null);
});

test('A6 · adding strict/broad fields does NOT change KC-2/KC-3 scored status', () => {
  const snap = clone(current);
  snap.auto.stablecoins.ethAlignedSharePctBroad = 55.2;
  snap.auto.stablecoins.ethAlignedSharePctStrict = 41.0; // far lower, but KC-2 must not move
  snap.auto.stablecoins.ethAlignedBroadMinusStrictPp = 14.2;
  snap.auto.rwa.ethAlignedSharePctStrict = 40;
  const { byId } = killOf(snap);
  assert.equal(byId['KC-2'].status, 'intact'); // still scores ethAlignedSharePct (broad) / mainnet
  assert.equal(byId['KC-3'].status, 'intact'); // still scores mainnet ethSharePct
});

// ====================================================================== A7
// KC-3 surfaces a labeled NEW-ISSUANCE flow read; default stock-hit logic is unchanged.
test('A7 · flowShareSinceOldest = Δnum ÷ Δden, null until ≥2 points / net growth', () => {
  const hist = [
    { rwaEthValueUsd: 14_000_000_000, rwaTotalUsd: 26_000_000_000 },
    { rwaEthValueUsd: 14_400_000_000, rwaTotalUsd: 28_000_000_000 },
  ];
  // ETH added 0.4B of the 2.0B new RWA value → 20% of new issuance
  assert.equal(flowShareSinceOldest(hist, 'rwaEthValueUsd', 'rwaTotalUsd'), 20);
  assert.equal(flowShareSinceOldest([hist[0]], 'rwaEthValueUsd', 'rwaTotalUsd'), null); // 1 point
  assert.equal(flowShareSinceOldest([], 'rwaEthValueUsd', 'rwaTotalUsd'), null);
  // market shrank → not attributable
  assert.equal(flowShareSinceOldest([{ rwaEthValueUsd: 5, rwaTotalUsd: 10 }, { rwaEthValueUsd: 4, rwaTotalUsd: 9 }], 'rwaEthValueUsd', 'rwaTotalUsd'), null);
});

test('A7 · KC-3 detail shows the flow read "accruing" with no history; status unchanged', () => {
  const c = killOf(current, []).byId['KC-3'];
  assert.equal(c.status, 'intact'); // stock 54.7% ≥ 50 → default logic unchanged
  assert.match(c.detail, /new RWA value/i);
  assert.match(c.detail, /accruing/i);
});

test('A7 · KC-3 detail shows a computed flow % once the log has ≥2 RWA-value points', () => {
  const histRows = [
    { rwaEthSharePct: 55, rwaEthValueUsd: 14_000_000_000, rwaTotalUsd: 26_000_000_000 },
    { rwaEthSharePct: 54.7, rwaEthValueUsd: 14_200_000_000, rwaTotalUsd: 28_000_000_000 },
  ];
  const c = killOf(current, histRows).byId['KC-3'];
  assert.match(c.detail, /10%/); // 0.2B of 2.0B new value = 10%
  assert.equal(c.status, 'intact'); // flow read is leading/labeled, does NOT change the hit trigger
});

// ====================================================================== B1
// Exit-rule experiment is off by default; alt rules only change output when opted in.
// Force KC-1 + KC-3 hits: take<0.5 & corr>0.85 past the 5y horizon (KC-1), RWA<50 (KC-3).
const twoCoreHits = () => {
  const snap = clone(current);
  // clock >5y ago → KC-1 hits; neutralise KC-4/KC-7 (whose horizons would also elapse) so
  // exactly KC-1 + KC-3 are hit and the count sits at 2/3 (the case that separates the rules).
  snap.manual.kill_criteria = {
    thesis_clock_start: '2018-01-01',
    kc4_l2_reflow: { top_l2_stage2_and_based: true },
    kc7_formal_verification: { material_progress: true },
  };
  snap.auto.rwa.ethSharePct = 40; // <50 → KC-3 hits
  return snap;
};

test('B1 · default (no flag) → count rule, identical triggering', () => {
  const k = killOf(current);
  assert.equal(k.experiment.exitRule, 'count');
  assert.equal(k.triggered, false); // 0 hits today
  assert.equal(k.experiment.weightedHitScore, 0);
  assert.equal(k.experiment.redAlert, false);
});

test('B1 · two core hits (KC-1+KC-3): count says NO exit, weighted & override say YES', () => {
  const base = twoCoreHits();
  assert.equal(killOf(base).byId['KC-1'].hit, true);
  assert.equal(killOf(base).byId['KC-3'].hit, true);

  const dflt = killOf(base); // count rule
  assert.equal(dflt.hitCount, 2);
  assert.equal(dflt.triggered, false); // 2 < 3
  assert.equal(dflt.experiment.weightedHitScore, 3.5); // 2.0 + 1.5
  assert.equal(dflt.experiment.redAlert, true);

  const weighted = clone(base); weighted.manual.experiments = { exit_rule: 'weighted' };
  assert.equal(killOf(weighted).triggered, true); // 3.5 ≥ 3

  const override = clone(base); override.manual.experiments = { exit_rule: 'single_hit_override' };
  assert.equal(killOf(override).triggered, true); // KC-1 hit → red alert
});

test('B1 · enabling a flag with 0 hits still does not trigger (no false exit)', () => {
  const snap = clone(current); snap.manual.experiments = { exit_rule: 'weighted' };
  assert.equal(killOf(snap).triggered, false);
});

export { current, clone, readFixture, chiOf, killOf };
