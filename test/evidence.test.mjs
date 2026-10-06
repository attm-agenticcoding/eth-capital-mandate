import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildEvidence, groupHealth, detectHistoryBreaks, sustainedObservation, assessStressEpisode, METHODOLOGY_VERSION } from '../src/lib/evidence.mjs';
import { computeCHI, mapProbabilities } from '../src/lib/chi.mjs';
import { computeKill, ETH_ALIGNED_CHAINS, ETH_ALIGNED_CHAINS_STRICT } from '../src/lib/kill.mjs';
const AS_OF = '2026-10-06T00:00:00.000Z';
const latest = JSON.parse(fs.readFileSync(new URL('./fixtures/legacy-2026-10-05.json', import.meta.url)));
const history = JSON.parse(fs.readFileSync(new URL('./fixtures/legacy-history.json', import.meta.url)));
const view = (s = latest, h = history, asOf = AS_OF) => buildEvidence(s, h, { asOf });
const metrics = (v) => Object.fromEntries(v.sections.flatMap((s) => s.metrics.map((m) => [m.id, m])));
function fresh() {
  const s = structuredClone(latest); s.schemaVersion = 2; s.methodologyVersion = METHODOLOGY_VERSION;
  for (const g of Object.values(s.auto)) if (g && typeof g === 'object') {
    g.stale = false;
    g.health = { status: 'ok', observedAt: '2026-10-05T23:00:00.000Z', fetchedAt: '2026-10-05T23:39:02.882Z', lastSuccessAt: '2026-10-05T23:39:02.882Z', ttlHours: 48 };
  }
  return s;
}
test('four distinct questions replace the aggregate', () => assert.deepEqual(view().sections.map((s) => s.id), ['holding', 'fees', 'stress', 'context']));
test('empty snapshot supplies no probability, score or value', () => {
  const v = view({}, []); assert.equal(v.market.price, null);
  assert.ok(v.sections.flatMap((s) => s.metrics).every((m) => m.value === null));
  assert.equal('probabilities' in v, false); assert.equal('score' in v, false);
});
test('retired scorers never synthesize a prior from missing data', () => {
  assert.equal(computeCHI({}).total, null); assert.equal(computeCHI(latest).probabilities, null);
  assert.equal(mapProbabilities(3, false), null); assert.equal(computeKill({}, []).triggered, null);
});
test('dropping a zero component cannot improve the model', () => {
  const a = structuredClone(latest); a.manual.experiments = { demote_chi5: true };
  assert.equal(view(a).reviewStatus, view().reviewStatus);
  assert.deepEqual(computeCHI(a), computeCHI(latest));
});
test('unknown correlation does not turn into monetary-premium evidence', () => {
  const s = fresh(); delete s.auto.correlation; const m = metrics(view(s));
  assert.equal(m['btc-correlation'].value, null); assert.equal(m['btc-correlation'].status, 'unknown');
  assert.equal(view(s).reviewStatus, view().reviewStatus);
});
test('low or high correlation never generates a thesis verdict', () => {
  const s = fresh(); s.auto.correlation.now = -0.5; assert.equal(view(s).reviewStatus, view().reviewStatus);
  assert.match(metrics(view(s))['btc-correlation'].caveat, /高相关不等于/);
});
test('legacy ETH-equivalent restaking is not genuine ETH', () => {
  const m = metrics(view()); assert.equal(m['underlying-eth'].value, null); assert.equal(m['slashable-eth'].value, null);
  assert.equal(m['restaking-tvl'].status, 'proxy'); assert.ok(m['restaking-tvl'].value > 0);
});
test('no Aave pool balance is presented as genuine collateral', () => assert.equal(metrics(view())['real-collateral'].value, null));
test('legacy max-LLTV does not become a weighted observed haircut', () => assert.equal(metrics(view())['morpho-lltv'].value, null));
test('new Morpho cohort supplies debt-weighted terms with proper caveat', () => {
  const s = fresh(); s.auto.collateral.morphoFinance = { debtWeightedLltvPct: 84.2, totalBorrowUsd: 2e9, health: structuredClone(s.auto.collateral.health) };
  const m = metrics(view(s)); assert.equal(m['morpho-lltv'].value, 84.2); assert.equal(m['morpho-borrow'].value, 2e9);
  assert.match(m['morpho-lltv'].caveat, /不是 Aave/);
});
test('outer collateral stale overrides apparently fresh LLTV subfield', () => {
  const s = fresh(); s.auto.collateral.stale = true; s.auto.collateral.ethMaxLltvStatus = 'ok'; s.auto.collateral.morphoFinance = { debtWeightedLltvPct: 86, health: structuredClone(s.auto.collateral.health) };
  assert.equal(metrics(view(s))['morpho-lltv'].status, 'stale');
});
test('partial restaking cohort does not render a shrunk headline', () => {
  const s = fresh(); s.auto.restaking.health.status = 'partial'; s.auto.restaking.totalUsd = 5;
  assert.equal(metrics(view(s))['restaking-tvl'].value, null);
});
test('missing Morpho does not create a more favorable collateral number', () => {
  const s = fresh(); s.auto.collateral.morphoOk = false; s.auto.collateral.combinedEthSharePct = 99;
  assert.equal(groupHealth(s, 'collateral', AS_OF).status, 'partial');
  assert.equal(metrics(view(s))['real-collateral'].value, null);
});
test('legacy asOf remains fetch time and never becomes observedAt', () => {
  const h = groupHealth(latest, '_market', AS_OF); assert.equal(h.observedAt, null); assert.equal(h.fetchedAt, latest.auto._market.asOf);
});
test('malformed declared observation is invalid even with a good fetch timestamp', () => {
  const s = fresh(); s.auto.supply.health.observedAt = 'not-a-date';
  assert.equal(groupHealth(s, 'supply', AS_OF).status, 'invalid');
});
test('future upstream observation is rejected rather than made fresh', () => {
  const s = fresh(); s.auto.supply.health.observedAt = '2026-10-07T00:00:00Z';
  assert.equal(groupHealth(s, 'supply', AS_OF).status, 'invalid');
  assert.equal(metrics(view(s))['native-stake'].value, null);
});
test('TTL expiration changes provenance status, never thesis state', () => {
  const s = fresh(); const before = view(s); const after = view(s, [], '2026-10-10T00:00:00Z');
  assert.equal(metrics(after)['native-stake'].status, 'stale'); assert.equal(after.reviewStatus, before.reviewStatus);
});
test('invalid assessment date cannot validate an episode', () => {
  const e = { id: 'x', startedAt: '2026-01-01', endedAt: '2027-01-01', source: 'https://example.com', methodologyVersion: METHODOLOGY_VERSION, basis: 'fixed-price-fixed-cohort', quantityShareDeltaPp: 10, eligibilityRetained: true };
  assert.equal(assessStressEpisode(e, { asOf: 'not-a-date' }).status, 'unknown');
});
test('legacy resolved flag cannot override a new stress episode', () => assert.equal(assessStressEpisode(latest.manual.chi1_stress, { asOf: AS_OF }).status, 'unknown'));
test('USD share changes cannot be accepted as quantity substitution', () => {
  const e = { id: 'x', startedAt: '2026-01-01', endedAt: '2026-06-01', source: 'https://example.com', methodologyVersion: METHODOLOGY_VERSION, basis: 'usd-share', quantityShareDeltaPp: -16.7, eligibilityRetained: true };
  assert.equal(assessStressEpisode(e, { asOf: AS_OF }).status, 'unknown');
});
test('quantity share improvement and exact -5pp are facts, not arbitrary threshold scores', () => {
  for (const delta of [10, -5]) {
    const e = { id: `x${delta}`, startedAt: '2026-01-01', endedAt: '2026-06-01', source: 'https://example.com', methodologyVersion: METHODOLOGY_VERSION, basis: 'fixed-price-fixed-cohort', quantityShareDeltaPp: delta, eligibilityRetained: true };
    const r = assessStressEpisode(e, { asOf: AS_OF }); assert.equal(r.status, 'observed'); assert.equal(r.quantityShareDeltaPp, delta); assert.equal('score' in r, false);
  }
});
test('unset manual milestones remain undecided after any deadline', () => {
  const s = structuredClone(latest); s.manual.kill_criteria.thesis_clock_start = '1900-01-01';
  assert.equal(computeKill(s, []).triggered, null); assert.equal(view(s).reviewStatus, view().reviewStatus);
});
test('eight same-time cron rows do not prove persistence', () => {
  const rows = Array.from({ length: 8 }, () => ({ methodologyVersion: METHODOLOGY_VERSION, observedAt: AS_OF, healthStatus: 'ok', value: 4 }));
  assert.equal(sustainedObservation(rows, { field: 'value', predicate: (v) => v > 3, days: 90, asOf: AS_OF }).status, 'unknown');
});
test('183 distinct daily observations cover elapsed time', () => {
  const rows = Array.from({ length: 184 }, (_, i) => ({ methodologyVersion: METHODOLOGY_VERSION, observedAt: new Date(Date.parse(AS_OF) - i * 86400000).toISOString(), healthStatus: 'ok', value: 40 }));
  assert.equal(sustainedObservation(rows, { field: 'value', predicate: (v) => v < 50, days: 183, asOf: AS_OF }).status, 'met');
  rows[5].value = 60; assert.equal(sustainedObservation(rows, { field: 'value', predicate: (v) => v < 50, days: 183, asOf: AS_OF }).status, 'not_met');
});
test('stale or wrong-version observations cannot fill persistence gaps', () => {
  const rows = Array.from({ length: 184 }, (_, i) => ({ methodologyVersion: METHODOLOGY_VERSION, observedAt: new Date(Date.parse(AS_OF) - i * 86400000).toISOString(), healthStatus: 'stale', value: 40 }));
  assert.equal(sustainedObservation(rows, { field: 'value', predicate: (v) => v < 50, days: 183, asOf: AS_OF }).status, 'unknown');
});
test('real Sept15 RWA discontinuity is flagged and its cause not invented', () => {
  const b = detectHistoryBreaks(history).find((x) => x.date.startsWith('2026-09-15'));
  assert.ok(b.changePct < -80); assert.match(b.detail, /不能直接解释/);
  assert.equal(metrics(view())['rwa-share'].status, 'invalid');
});
test('old RWA stock delta is never exposed as new issuance flow', () => {
  const v = view(); assert.equal('newIssuanceFlow' in v, false);
  assert.equal(metrics(v)['rwa-share'].value, null);
});
test('history versions remain distinct; no score splicing', () => {
  const v = view(); assert.equal(v.history.legacyCount, history.length); assert.equal(v.history.currentCount, 0); assert.equal(v.history.comparable, false);
});
test('derived fee ratio is unknown if market source is stale', () => {
  const s = fresh(); s.auto.fees.reportedL1FeesToMarketCapPctPerYr = 0.06; s.auto._market.health.status = 'stale';
  assert.equal(metrics(view(s))['fees-mcap'].value, null);
});
test('real zero burn is preserved, missing burn remains unknown', () => {
  const s = fresh(); s.auto.supply.burn30dEth = 0; assert.equal(metrics(view(s))['burn-rate'].value, 0);
  s.auto.supply.burn30dEth = null; assert.equal(metrics(view(s))['burn-rate'].value, null);
});
test('negative ETH balances and out-of-range correlations are invalid', () => {
  const s = fresh(); s.auto.supply.stakedEffectiveEth = -1; s.auto.correlation.now = 2;
  assert.equal(metrics(view(s))['native-stake'].status, 'invalid'); assert.equal(metrics(view(s))['btc-correlation'].value, null);
});
test('chain sets remain available for context, not automatic exits', () => {
  assert.ok(ETH_ALIGNED_CHAINS_STRICT.every((x) => ETH_ALIGNED_CHAINS.includes(x)));
  assert.ok(!ETH_ALIGNED_CHAINS_STRICT.includes('Polygon'));
});
test('model never mutates the snapshot or legacy history', () => {
  const a = JSON.stringify(latest), h = JSON.stringify(history); view(); assert.equal(JSON.stringify(latest), a); assert.equal(JSON.stringify(history), h);
});

test('invalid numeric range dominates stale source status', () => {
  const s = fresh(); s.auto.supply.health.status = 'stale'; s.auto.supply.stakedEffectiveEth = -100;
  const m = metrics(view(s))['native-stake']; assert.equal(m.status, 'invalid'); assert.equal(m.value, null);
});
test('stale source cannot invent lastSuccessAt from current fetch', () => {
  const s = fresh(); s.auto.supply.health.status = 'stale'; s.auto.supply.health.lastSuccessAt = null;
  assert.equal(groupHealth(s, 'supply', AS_OF).lastSuccessAt, null);
});

test('impossible calendar dates are invalid, not normalized', () => {
  const s = fresh(); s.auto.supply.health.observedAt = '2026-02-31T00:00:00Z';
  assert.equal(groupHealth(s, 'supply', AS_OF).status, 'invalid');
});
test('even a near-future observation is not available as of assessment', () => {
  const s = fresh(); s.auto.supply.health.observedAt = '2026-10-06T00:01:00Z';
  assert.equal(groupHealth(s, 'supply', AS_OF).status, 'invalid');
});
test('unrelated composition gaps do not suppress independently verified Morpho finance', () => {
  const s = fresh(); s.auto.collateral.morphoFinance = { debtWeightedLltvPct: 84, totalBorrowUsd: 100, health: structuredClone(s.auto.collateral.health) };
  s.auto.collateral.health.status = 'partial';
  assert.equal(metrics(view(s))['morpho-lltv'].value, 84);
});

test('invalid Morpho observation dominates parent stale state', () => {
  const s = fresh(); s.auto.collateral.health.status = 'stale';
  s.auto.collateral.morphoFinance = { debtWeightedLltvPct: 84, health: { ...s.auto.collateral.health, status: 'ok', observedAt: '2027-01-01T00:00:00Z' } };
  const m = metrics(view(s))['morpho-lltv']; assert.equal(m.status, 'invalid'); assert.equal(m.value, null);
});
