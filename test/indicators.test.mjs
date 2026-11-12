import test from 'node:test';
import assert from 'node:assert/strict';
import { usdDebtByCollateral, trailingRange, burnOffsetPct, sharePct, assessCohortChange, parseEipFrontMatter } from '../src/lib/indicators.mjs';
import { classifyToken, isUsdStable } from '../src/lib/tokens.mjs';

const DAY = 86400000, T0 = Date.parse('2026-01-01T00:00:00Z');
const market = (collateralSymbol, loanSymbol, borrowUsd, lltvPct = 86) => ({ collateralSymbol, loanSymbol, borrowUsd, lltvPct });
const daily = (values) => values.map((v, i) => ({ t: T0 + i * DAY, v }));

test('token families are explicit; lookalike symbols are other', () => {
  assert.equal(classifyToken('wstETH'), 'eth'); assert.equal(classifyToken('cbBTC'), 'btc'); assert.equal(classifyToken('usdc'), 'stable');
  for (const symbol of ['PT-sUSDE', 'syrupUSDC', 'stETH-LP', 'XAUT', 'EURC', '', null]) assert.equal(classifyToken(symbol), 'other', String(symbol));
  assert.equal(isUsdStable('USDtb'), true); assert.equal(isUsdStable('PAXG'), false); assert.equal(isUsdStable('WETH'), false);
});

test('dollar debt split counts only USD-stable loans and groups by collateral family', () => {
  const split = usdDebtByCollateral([market('WETH', 'USDC', 100, 86), market('wstETH', 'DAI', 100, 80), market('cbBTC', 'USDC', 600, 86),
    market('PT-sUSDE', 'USDC', 200, 91.5), market('wstETH', 'WETH', 9000, 96.5), market('WETH', 'PAXG', 9000, 99), market('WBTC', 'EURC', 9000, 86)]);
  assert.equal(split.complete, true); assert.equal(split.marketCount, 4); assert.equal(split.totalUsdDebt, 1000);
  assert.deepEqual([split.ethSharePct, split.btcSharePct, split.otherSharePct], [20, 60, 20]);
  assert.equal(split.ethToBtcDebtRatio, 0.3333);
  assert.equal(split.ethDebtWeightedLltvPct, 83); assert.equal(split.btcDebtWeightedLltvPct, 86); assert.equal(split.lltvGapPp, -3);
  assert.deepEqual([split.ethMarketCount, split.btcMarketCount, split.otherMarketCount], [2, 1, 1]);
});

test('dollar debt split withholds everything when any borrow balance is missing', () => {
  for (const bad of [null, undefined, NaN, -1, '100']) {
    const split = usdDebtByCollateral([market('WETH', 'USDC', 100), market('cbBTC', 'USDC', bad)]);
    assert.equal(split.complete, false); assert.equal(split.ethSharePct, null); assert.equal(split.totalUsdDebt, null); assert.equal(split.missingBorrow, 1);
  }
  for (const empty of [null, undefined, [], [market('wstETH', 'WETH', 5)]]) assert.equal(usdDebtByCollateral(empty).complete, false);
});

test('a real zero is kept, and an unusable LLTV removes only the LLTV comparison', () => {
  const none = usdDebtByCollateral([market('WETH', 'USDC', 0), market('cbBTC', 'USDC', 50)]);
  assert.equal(none.ethSharePct, 0); assert.equal(none.btcSharePct, 100); assert.equal(none.ethToBtcDebtRatio, 0);
  assert.equal(none.ethDebtWeightedLltvPct, null); assert.equal(none.lltvGapPp, null);
  const noBtc = usdDebtByCollateral([market('WETH', 'USDC', 50)]);
  assert.equal(noBtc.ethSharePct, 100); assert.equal(noBtc.ethToBtcDebtRatio, null);
  const badLltv = usdDebtByCollateral([market('WETH', 'USDC', 50, null), market('cbBTC', 'USDC', 50, 86)]);
  assert.equal(badLltv.ethSharePct, 50); assert.equal(badLltv.ethDebtWeightedLltvPct, null); assert.equal(badLltv.lltvGapPp, null);
});

test('trailing range places the live value and reports fresh extremes', () => {
  const series = daily(Array.from({ length: 366 }, (_, i) => 0.03 + 0.005 * Math.sin(i / 58)));
  const end = series.at(-1).t + 3600000;
  const inside = trailingRange(series, 0.03, end);
  assert.equal(inside.status, 'observed'); assert.equal(inside.newLow, false); assert.equal(inside.newHigh, false);
  assert.ok(inside.positionPct > 0 && inside.positionPct < 100); assert.ok(inside.coverageDays >= 365);
  const low = trailingRange(series, 0.02, end);
  assert.equal(low.newLow, true); assert.equal(low.positionPct, 0); assert.equal(low.low, 0.02); assert.equal(low.daysSinceLow, 0);
  const high = trailingRange(series, 0.05, end);
  assert.equal(high.newHigh, true); assert.equal(high.positionPct, 100); assert.equal(high.daysSinceHigh, 0);
});

test('trailing range is unknown without full, gap-free, current daily coverage', () => {
  const full = daily(Array.from({ length: 366 }, () => 0.03)), end = full.at(-1).t;
  assert.equal(trailingRange(full.slice(-200), 0.03, end).status, 'unknown');
  assert.equal(trailingRange(full.filter((_, i) => i % 3 === 0), 0.03, end).status, 'unknown');
  assert.equal(trailingRange(full, 0.03, end + 5 * DAY).status, 'unknown');
  assert.equal(trailingRange(full, 0.03, end - DAY).status, 'unknown');
  for (const live of [null, 0, -1, NaN]) assert.equal(trailingRange(full, live, end).status, 'unknown');
  assert.equal(trailingRange([], 0.03, end).status, 'unknown');
});

test('burn offset and shares keep zero, reject missing or impossible inputs', () => {
  assert.equal(burnOffsetPct(0, 100), 0); assert.equal(burnOffsetPct(10, 100), 10); assert.equal(burnOffsetPct(150, 100), 150);
  for (const [b, i] of [[null, 100], [10, null], [10, 0], [10, -5], [-1, 100]]) assert.equal(burnOffsetPct(b, i), null);
  assert.equal(sharePct(36, 120), 30); assert.equal(sharePct(0, 120), 0); assert.equal(sharePct(1, 0), null); assert.equal(sharePct(null, 1), null);
});

test('cohort change: additions pass, removals need a known immaterial or reviewed balance', () => {
  const base = { expected: ['A', 'B', 'C'], lastBalances: { A: 900, B: 99.96, C: 0.04 }, priorTotal: 1000, materialityPct: 0.05 };
  assert.equal(assessCohortChange({ ...base, observed: ['A', 'B', 'C', 'D'] }).accepted, true);
  const tiny = assessCohortChange({ ...base, observed: ['A', 'B'] });
  assert.equal(tiny.accepted, true); assert.equal(tiny.droppedPct, 0.004);
  const material = assessCohortChange({ ...base, observed: ['A', 'C'] });
  assert.equal(material.accepted, false); assert.match(material.reason, /material/);
  assert.equal(assessCohortChange({ ...base, lastBalances: {}, observed: ['A', 'B'] }).accepted, false);
  assert.equal(assessCohortChange({ ...base, priorTotal: null, observed: ['A', 'B'] }).accepted, false);
  // A review stands in for a missing record: it supplies the balance and the total it was measured against.
  const review = { C: { lastUsd: 488.38, priorTotalUsd: 305.4e9 } };
  const reviewed = assessCohortChange({ ...base, lastBalances: {}, priorTotal: null, observed: ['A', 'B'], reviewedDrops: review });
  assert.equal(reviewed.accepted, true); assert.equal(reviewed.dropped[0].reviewed, true); assert.equal(reviewed.droppedPct, 2e-7);
  assert.equal(assessCohortChange({ ...base, lastBalances: {}, priorTotal: null, observed: ['A', 'B'], reviewedDrops: { C: { lastUsd: 488.38 } } }).accepted, false);
  assert.equal(assessCohortChange({ ...base, lastBalances: {}, priorTotal: null, observed: ['A', 'B'], reviewedDrops: { C: { lastUsd: 0 } } }).accepted, true);
  // It never overrides a balance that is on record: a reviewed name that later held 50% still blocks.
  const regrown = assessCohortChange({ expected: ['A', 'C'], observed: ['A'], lastBalances: { A: 500, C: 500 }, priorTotal: 1000, reviewedDrops: review });
  assert.equal(regrown.accepted, false); assert.equal(regrown.dropped[0].reviewed, false);
  // An unreviewed name that merely collides with an object method is not treated as reviewed.
  assert.equal(assessCohortChange({ expected: ['A', 'toString'], observed: ['A'], lastBalances: {}, priorTotal: 10 }).accepted, false);
  assert.equal(assessCohortChange({ expected: null, observed: ['A'] }).accepted, true);
});

test('EIP status comes from the front matter of the expected proposal only', () => {
  const file = (status, eip = 8363, eol = '\n') => ['---', `eip: ${eip}`, 'title: Tapered Issuance Burn', `status: ${status}`, 'created: 2026-07-14', '---', '', 'status: Final'].join(eol);
  assert.deepEqual(parseEipFrontMatter(file('Draft'), 8363), { eip: 8363, title: 'Tapered Issuance Burn', status: 'Draft', created: '2026-07-14', category: null });
  assert.equal(parseEipFrontMatter(file('Last Call', 8363, '\r\n'), 8363).status, 'Last Call');
  for (const bad of [file('Draft', 1559), file('Approved'), 'status: Final', '', null, 42]) assert.equal(parseEipFrontMatter(bad, 8363), null);
});
