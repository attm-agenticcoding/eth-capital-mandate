import fs from 'node:fs';
import assert from 'node:assert/strict';
import { SCHEMA_VERSION, METHODOLOGY_VERSION } from '../src/lib/evidence.mjs';
import { RULES_VERSION, SIGNALS } from '../src/lib/signals.mjs';
const target = process.argv[2] || 'data/latest.json';
const s = JSON.parse(fs.readFileSync(target, 'utf8'));
assert.equal(s.schemaVersion, SCHEMA_VERSION);
assert.equal(s.methodologyVersion, METHODOLOGY_VERSION);
assert.ok(Number.isFinite(Date.parse(s.generatedUtc)), 'valid snapshot timestamp');
assert.ok(Date.parse(s.generatedUtc) <= Date.now() + 300000, 'snapshot cannot come from the future');
for (const name of ['chi', 'probabilities', 'p10k', 'p20k', 'branchPct']) assert.ok(!(name in s), `no new ${name}`);
for (const [key, group] of Object.entries(s.auto || {})) {
  assert.ok(group && typeof group === 'object', `${key}: object`);
  assert.ok(['ok', 'stale', 'partial', 'failed'].includes(group.health?.status), `${key}: explicit health`);
  assert.ok(Number.isFinite(Date.parse(group.health.fetchedAt)), `${key}: fetch time`);
  if (group.health.observedAt !== null) {
    assert.ok(Number.isFinite(Date.parse(group.health.observedAt)), `${key}: real observation time`);
    assert.ok(Date.parse(group.health.observedAt) <= Date.parse(s.generatedUtc), `${key}: observation not future`);
  }
}
assert.equal(s.auto.collateral?.combinedEthSharePct ?? null, null, 'heterogeneous collateral aggregate retired');
assert.equal(s.auto.collateral?.combinedEthShareDeltaPp ?? null, null, 'synthetic historical drift retired');
assert.equal(s.auto.restaking?.restakedEth ?? null, null, 'ETH equivalent never called true ETH');
assert.equal(s.auto.restaking?.underlyingEth ?? null, null, 'unmeasured underlying ETH stays unknown');
assert.equal(s.auto.restaking?.slashableEth ?? null, null, 'unmeasured active allocation stays unknown');
assert.equal(s.auto.fees?.fullFeesToMarketCapPctPerYr ?? null, null, 'unverified all-DA fee aggregation withheld');
if (!process.argv[2]) {
  const h = JSON.parse(fs.readFileSync('data/history.json', 'utf8'));
  const rows = fs.readFileSync('data/history.ndjson', 'utf8').trim().split('\n').filter(Boolean);
  const last = h.at(-1);
  assert.deepEqual(last, JSON.parse(rows.at(-1)), 'both history forms end in the same appended record');
  assert.equal(last.t, s.generatedUtc);
  assert.equal(last.methodologyVersion, METHODOLOGY_VERSION);
  for (const name of ['chiTotal', 'scores', 'p10k', 'p20k', 'branchPct']) assert.ok(!(name in last), `no new historical ${name}`);
}
// A sub-measure with its own health never publishes numbers that health does not cover.
const split = s.auto.collateral?.usdDebtByCollateral;
if (split && split.health?.status !== 'ok' && !s.auto.collateral?.stale && s.auto.collateral?.health?.status !== 'stale') {
  for (const field of ['ethSharePct', 'btcSharePct', 'totalUsdDebt', 'ethToBtcDebtRatio']) assert.equal(split[field] ?? null, null, `incomplete debt split withholds ${field}`);
}
if (s.auto.stablecoins?.cohortChanged) assert.equal(s.auto.stablecoins.totalUsd ?? null, null, 'unreviewed cohort change withholds the stablecoin total');
if (s.auto.treasuries?.cohortMissing?.length) assert.equal(s.auto.treasuries.cohortHoldingsEth ?? null, null, 'incomplete treasury cohort withholds its total');
if (!process.argv[2] && fs.existsSync('data/signals.json')) {
  const f = JSON.parse(fs.readFileSync('data/signals.json', 'utf8'));
  assert.equal(f.rulesVersion, RULES_VERSION, 'signal state matches the rule version');
  assert.ok(Number.isFinite(Date.parse(f.updatedAt)) && Date.parse(f.updatedAt) <= Date.now() + 300000, 'valid signal timestamp');
  for (const def of SIGNALS) {
    const entry = f.signals?.[def.id];
    assert.ok(entry && 'state' in entry && 'dataOk' in entry, `${def.id}: recorded`);
    if (entry.state !== null && def.kind !== 'category') assert.ok(def.states[entry.state], `${def.id}: known state`);
    if (entry.state === null) assert.equal(entry.dataOk, false, `${def.id}: no state without a reading`);
  }
  assert.doesNotMatch(JSON.stringify(f), /"(?:score|probability|probabilities|chi|p10k|p20k|target|verdict)"/i, 'signals carry no score, probability or target');
}
console.log(`Verified ${target}: evidence v2, explicit health and no inferred score/probability`);
