import fs from 'node:fs';
import assert from 'node:assert/strict';
import { SCHEMA_VERSION, METHODOLOGY_VERSION } from '../src/lib/evidence.mjs';
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
console.log(`Verified ${target}: evidence v2, explicit health and no inferred score/probability`);
