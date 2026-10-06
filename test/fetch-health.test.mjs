import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFetchers, buildSnapshot, historyRow, run, appendHistory, bucketize, classifyToken, sanitizeLegacy } from '../scripts/fetch.mjs';
import { numberOrNull, sumComplete, observationTime, makeHealth, rv365Persistence, SCHEMA_VERSION, METHODOLOGY_VERSION } from '../src/lib/fetch-health.mjs';
const NOW = '2026-10-06T00:00:00.000Z';
const good = (value) => ({ ok: true, status: 200, json: async () => structuredClone(value) });
const fail = { ok: false, status: 403, json: async () => ({}) };
const noFetch = async () => fail;
const health = (cohortId = null) => ({ status: 'ok', fetchedAt: '2026-10-05T18:00:00.000Z', observedAt: '2026-10-05T12:00:00.000Z', lastSuccessAt: '2026-10-05T18:00:00.000Z', ttlHours: 48, reason: null, cohortId, coverage: { expected: 3, received: 3 } });
const factories = (fetchImpl, previous = {}) => createFetchers({ fetchImpl, previous, now: NOW, retries: 1, retryDelay: 0 });
function priceFixture(asset) {
  return { prices: Array.from({ length: 366 }, (_, i) => [Date.parse(NOW) - (365 - i) * 86400000, (asset === 'ethereum' ? 2000 : 60000) * Math.exp(i / 10000)]) };
}
const marketFetch = async (url) => url.includes('/coins/markets?') ? good([
  { id: 'ethereum', current_price: 2500, market_cap: 300e9, ath: 5000, circulating_supply: 120e6, last_updated: NOW },
  { id: 'bitcoin', current_price: 70000, market_cap: 1400e9, last_updated: NOW },
]) : url.includes('/ethereum/market_chart?') ? good(priceFixture('ethereum'))
  : url.includes('/bitcoin/market_chart?') ? good(priceFixture('bitcoin')) : fail;
const tokens = (values) => ({ chainTvls: { Ethereum: { tokensInUsd: [{ date: Date.parse('2026-10-05') / 1000, tokens: values }] } } });
const morphoMarkets = [
  { marketId: 'eth-usdc-1', listed: true, lltv: '800000000000000000', loanAsset: { symbol: 'USDC' }, collateralAsset: { symbol: 'WETH' }, state: { collateralAssetsUsd: 100, borrowAssetsUsd: 40 } },
  { marketId: 'eth-dai-2', listed: true, lltv: '900000000000000000', loanAsset: { symbol: 'DAI' }, collateralAsset: { symbol: 'wstETH' }, state: { collateralAssetsUsd: 200, borrowAssetsUsd: 60 } },
  { marketId: 'eth-eth-loop', listed: true, lltv: '980000000000000000', loanAsset: { symbol: 'WETH' }, collateralAsset: { symbol: 'wstETH' }, state: { collateralAssetsUsd: 900, borrowAssetsUsd: 800 } },
  { marketId: 'eth-gold', listed: true, lltv: '990000000000000000', loanAsset: { symbol: 'PAXG' }, collateralAsset: { symbol: 'WETH' }, state: { collateralAssetsUsd: 900, borrowAssetsUsd: 800 } },
];
const collateralFetch = async (url) => url.includes('/aave-v3') ? good(tokens({ WETH: 100, USDC: 50 }))
  : url.includes('/makerdao') ? good(tokens({ WETH: 25, USDC: 80 }))
    : url.includes('morpho.org') ? good({ data: { markets: { items: morphoMarkets } } }) : fail;
function feeFixture({ omitBlob = false, zero = false, future = false } = {}) {
  const rows = [];
  for (let i = 0; i < 30; i++) {
    const date = new Date(Date.parse('2026-10-05') - i * 86400000).toISOString().slice(0, 10);
    rows.push({ date, metric_key: 'fees_paid_usd', origin_key: 'ethereum', value: zero ? 0 : 100 });
    if (!(omitBlob && i === 4)) rows.push({ date, metric_key: 'costs_blobs_usd', origin_key: 'base', value: zero ? 0 : 10 });
    rows.push({ date, metric_key: 'costs_total_usd', origin_key: 'base', value: zero ? 0 : 15 });
    rows.push({ date, metric_key: 'fees_paid_usd', origin_key: 'base', value: zero ? 0 : 30 });
  }
  rows.push({ date: '2026-10-05', metric_key: 'stables_mcap', origin_key: 'ethereum', value: 1000 });
  rows.push({ date: '2026-10-05', metric_key: 'tvl', origin_key: 'ethereum', value: 2000 });
  if (future) rows.push({ date: '2026-10-31', metric_key: 'fees_paid_usd', origin_key: 'ethereum', value: 1e12 });
  return rows;
}

test('missing and zero are distinct throughout aggregation and token classification', () => {
  for (const value of [null, undefined, '', '   ', [], {}, false, NaN, Infinity]) assert.equal(numberOrNull(value), null);
  assert.equal(numberOrNull(0), 0);
  assert.equal(sumComplete([0, 0]), 0);
  assert.equal(sumComplete([0, null]), null);
  assert.equal(bucketize({ ETH: null }), null);
  assert.deepEqual(bucketize({ ETH: 0 }), { eth: 0, stable: 0, btc: 0, other: 0 });
  assert.equal(classifyToken('PAXG'), 'other'); assert.equal(classifyToken('EURC'), 'other');
  assert.equal(classifyToken('unknownUSD'), 'other'); assert.equal(classifyToken('PT-ETH'), 'other');
});

test('HTTP 403 recovers all market groups from previous.auto, not metadata', async () => {
  const previous = { auto: { _market: { stale: false, asOf: NOW }, eth: { price: 2500, mcap: 300e9, health: health() },
    btc: { price: 60000, health: health() }, ratio: { now: 0.04, health: health() },
    vol: { d365Pct: 48, quartersUnder50: 4, health: health() }, correlation: { now: 0.8, health: health() } } };
  const result = await factories(noFetch, previous).market();
  for (const key of ['eth', 'btc', 'ratio', 'vol', 'correlation']) {
    assert.equal(result[key].health.status, 'stale'); assert.equal(result[key].health.fetchedAt, NOW);
    assert.equal(result[key].health.lastSuccessAt, previous.auto[key].health.lastSuccessAt);
  }
  assert.equal(result.eth.price, 2500); assert.equal(result.btc.price, 60000); assert.equal(result.ratio.now, .04);
  assert.equal(result.vol.d365Pct, 48); assert.equal(result.vol.quartersUnder50, null); assert.equal(result.correlation.now, .8);
});

test('observation timestamp is never replaced by request time or a future date', () => {
  assert.equal(observationTime(null, NOW), null);
  assert.equal(observationTime('2026-11-01', NOW), null);
  const h = makeHealth({ now: NOW, observedAt: '2026-11-01' });
  assert.equal(h.observedAt, null); assert.equal(h.status, 'partial'); assert.equal(h.fetchedAt, NOW);
  assert.equal(makeHealth({ now: NOW }).observedAt, null);
  assert.equal(makeHealth({ now: NOW, observedAt: '2026-01-01', ttlHours: 24 }).status, 'stale');
});

test('Morpho only uses actual identified USD-stable loan markets for finance LLTV', async () => {
  const result = await factories(collateralFetch).collateral();
  assert.equal(result.health.status, 'ok'); assert.equal(result.combinedEthSharePct, null); assert.equal(result.combinedEthShareDeltaPp, null);
  assert.deepEqual(result.drift, []);
  assert.equal(result.morphoFinance.totalBorrowUsd, 100); assert.equal(result.morphoFinance.totalCollateralUsd, 300);
  assert.equal(result.morphoFinance.borrowWeightedLltvPct, 86); assert.equal(result.morphoFinance.marketCount, 2);
  assert.equal(result.morphoFinance.morphoExtremeMaxLltvPct, 90);
  assert.deepEqual(result.morphoFinance.markets.map((m) => m.id), ['eth-usdc-1', 'eth-dai-2']);
  assert.match(result.perVenue[0].basis, /pool composition proxy/);
  assert.equal(result.perVenue[0].observedAt, '2026-10-05T00:00:00.000Z');
  assert.equal(result.sources.morpho.observedAt, null);
  assert.equal('ethMaxLltvPct' in result, false);
});

test('partial collateral cannot silently shrink denominator; prior complete cohort freezes', async () => {
  const original = await factories(collateralFetch).collateral();
  const mock = (url) => url.includes('morpho.org') ? Promise.resolve(fail) : collateralFetch(url);
  const result = await factories(mock, { auto: { collateral: original } }).collateral();
  assert.equal(result.health.status, 'stale'); assert.equal(result.health.coverage.frozen, true);
  assert.equal(result.perVenue.length, 3); assert.equal(result.currentAttempt.perVenue.length, 2);
  assert.equal(result.sources.morpho.status, 'failed'); assert.equal(result.combinedEthSharePct, null);
  const first = await factories(mock).collateral();
  assert.equal(first.health.status, 'partial'); assert.equal(first.combinedTotalUsd, null);
});

test('partial restaking freezes the three-protocol cohort and never invents security ETH', async () => {
  const old = { totalUsd: 600, byProtocol: { eigenlayer: 100, symbiotic: 200, karak: 300 }, health: health('eigenlayer+symbiotic+karak:usd-tvl:v2') };
  const mock = async (url) => url.endsWith('/karak') ? fail : good(100);
  const result = await factories(mock, { auto: { restaking: old } }).restaking();
  assert.equal(result.health.status, 'stale'); assert.equal(result.totalUsd, 600);
  assert.equal(result.sources.karak.status, 'failed'); assert.equal(result.currentAttempt.byProtocol.karak, null);
  const first = await factories(mock).restaking(); assert.equal(first.totalUsd, null); assert.equal(first.health.status, 'partial');
  const zero = await factories(async () => good(0)).restaking(); assert.equal(zero.totalUsd, 0); assert.equal(zero.underlyingEth, null);
  const clean = sanitizeLegacy('restaking', { restakedEth: 10, restakedToStakedPct: 3 });
  assert.equal('restakedEth' in clean, false); assert.equal(clean.restakedEthEquivalent, null); assert.equal(clean.slashableEth, null);
});

test('fee missing day stays null, genuine zero remains zero, dates are raw observed dates', async () => {
  const mock = (fixture) => async () => good(fixture);
  const missing = await factories(mock(feeFixture({ omitBlob: true }))).fees();
  assert.equal(missing.l1PlusBlob30dAvgUsd, null); assert.equal(missing.annualizedFullFeesUsd, null);
  assert.equal(missing.obsoleteFeesToOnchainValuePctPerYr, 1216.667); assert.equal(missing.health.status, 'ok');
  assert.equal(missing.rawFeeSeries.find((r) => r.t === '2026-10-01').fullFeesUsd, null);
  const zero = await factories(mock(feeFixture({ zero: true }))).fees();
  assert.equal(zero.l1PlusBlob30dAvgUsd, null); assert.equal(zero.l1Fees30dAvgUsd, 0); assert.equal(zero.obsoleteFeesToOnchainValuePctPerYr, 0);
  assert.equal(zero.feeObservationDate, '2026-10-05'); assert.equal(zero.health.observedAt, '2026-10-05T00:00:00.000Z');
  assert.equal(zero.takeRatePctPerYr, null);
  const future = await factories(mock(feeFixture({ future: true }))).fees();
  assert.equal(future.rawFeeSeries.some((r) => r.t > NOW), false); assert.equal(future.l1FeesLatestUsd, 100);
});

test('RV quarters remain descriptive and persistence requires elapsed-time coverage', async () => {
  const market = await factories(marketFetch).market();
  assert.equal(market.vol.health.status, 'ok'); assert.equal(market.vol.quartersUnder50, null);
  assert.equal(market.vol.quarterVols.length, 4); assert.equal(market.vol.rv365Persistence.status, 'unknown');
  const row = (t) => ({ schemaVersion: SCHEMA_VERSION, methodologyVersion: METHODOLOGY_VERSION, t, vol365: 40, groupHealth: { vol: { ...health(), observedAt: t } } });
  const denseShort = Array.from({ length: 800 }, (_, i) => row(new Date(Date.parse(NOW) - i * 3600000).toISOString()));
  assert.equal(rv365Persistence(denseShort, row(NOW), NOW).status, 'unknown');
  const sparse = [row('2026-01-01')]; assert.equal(rv365Persistence(sparse, row(NOW), NOW).status, 'unknown');
  const daily = Array.from({ length: 185 }, (_, i) => row(new Date(Date.parse(NOW) - i * 86400000).toISOString()));
  assert.equal(rv365Persistence(daily, row(NOW), NOW).belowThreshold, true);
});

test('RWA large stock changes flagged, never labeled new issuance', async () => {
  const result = await factories(async () => good([{ name: 'p', category: 'RWA', chainTvls: { Ethereum: 150 } }]), { auto: { rwa: { totalUsd: 100 } } }).rwa();
  assert.equal(result.stockChangePct, 50); assert.equal(result.manualReviewRequired, true); assert.equal(result.newIssuanceUsd, null);
  assert.match(result.limitations, /Stock change is not new issuance/);
});

test('new snapshots/rows contain no scores or price probabilities, mixed-date conversion withheld', async () => {
  const snapshot = await buildSnapshot({ fetchImpl: marketFetch, now: NOW, retries: 1, retryDelay: 0 });
  assert.equal(snapshot.schemaVersion, 2); assert.equal(snapshot.methodologyVersion, 'eth-evidence-v2');
  const row = historyRow(snapshot);
  for (const key of ['chi', 'chiTotal', 'scores', 'p10k', 'p20k', 'branchPct', 'probabilities']) {
    assert.equal(key in snapshot, false); assert.equal(key in row, false);
  }
  for (const [key, group] of Object.entries(snapshot.auto)) {
    assert.ok(group.health, key); for (const field of ['status', 'fetchedAt', 'observedAt', 'lastSuccessAt', 'ttlHours', 'reason', 'coverage']) assert.ok(field in group.health, `${key}.${field}`);
  }
  assert.equal(snapshot.auto.restaking.restakedEthEquivalent, null);
  assert.equal(snapshot.auto.fees.fullFeesToMarketCapPctPerYr, null);
});

test('reported L1 fee / market cap ratio is separate, timestamp compatible and not holder cash flow', async () => {
  const fetchImpl = (url) => url.includes('fundamentals.json') ? Promise.resolve(good(feeFixture())) : marketFetch(url);
  const snapshot = await buildSnapshot({ fetchImpl, now: NOW, retries: 1, retryDelay: 0 });
  const fees = snapshot.auto.fees;
  assert.equal(fees.fullFeesToMarketCapPctPerYr, null);
  assert.equal(fees.reportedL1FeesToMarketCapPctPerYr, 0.000012);
  assert.equal(fees.obsoleteFeesToOnchainValuePctPerYr, 1216.667);
  assert.equal(fees.ratioCoverage.compatibleObservations, true);
  assert.match(fees.reportedL1FeesBasis, /not holder cash flow/);
});

test('historical row bytes are preserved, append-only; importing does not run requests', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eth-evidence-test-'));
  try {
    const historical = '{ "t" : "2025-01-01", "chiTotal":1, "p10k":35 }';
    const log = historical + '\n';
    fs.writeFileSync(path.join(dir, 'history.json'), '[\n' + historical + '\n]\n');
    fs.writeFileSync(path.join(dir, 'history.ndjson'), log);
    appendHistory(dir, { t: NOW, schemaVersion: 2 });
    assert.ok(fs.readFileSync(path.join(dir, 'history.json'), 'utf8').includes(historical));
    assert.ok(fs.readFileSync(path.join(dir, 'history.ndjson'), 'utf8').startsWith(log));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8')).length, 2);
    await run({ dataDir: dir, fetchImpl: noFetch, now: NOW, retries: 1, retryDelay: 0 });
    const rows = JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8'));
    assert.equal(rows.length, 3); assert.equal(rows[0].p10k, 35); assert.equal('p10k' in rows[2], false);
    assert.ok(fs.readFileSync(path.join(dir, 'history.json'), 'utf8').includes(historical));
    assert.ok(fs.readFileSync(path.join(dir, 'history.ndjson'), 'utf8').startsWith(log));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


test('repeat fetches of one RV365 observation cannot manufacture elapsed persistence', () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({ schemaVersion: 2, methodologyVersion: METHODOLOGY_VERSION,
    t: new Date(Date.parse(NOW) - i * 86400000).toISOString(), vol365: 40,
    groupHealth: { vol: { ...health(), observedAt: '2026-10-05T00:00:00.000Z' } } }));
  const result = rv365Persistence(rows, rows[0], NOW);
  assert.equal(result.status, 'unknown'); assert.equal(result.samples, 1); assert.equal(result.elapsedDays, 0);
});

test('stablecoin and fee disappeared members require cohort review across repeated runs', async () => {
  const stablePrevious = { auto: { stablecoins: { health: health('Ethereum|Solana') } } };
  const stableFetch = async () => good([{ name: 'Ethereum', totalCirculatingUSD: { peggedUSD: 100 } }]);
  const stable = await factories(stableFetch, stablePrevious).stablecoins();
  assert.equal(stable.health.status, 'partial'); assert.equal(stable.totalUsd, null); assert.equal(stable.ethSharePct, null);
  assert.equal(stable.health.cohortId, 'Ethereum|Solana'); assert.equal(stable.cohortReviewRequired, true);
  const again = await factories(stableFetch, { auto: { stablecoins: stable } }).stablecoins();
  assert.equal(again.health.status, 'partial');
  const feePrevious = { auto: { fees: { health: health('execution+blob:arbitrum|base') } } };
  const feeFetch = async () => good(feeFixture());
  const fees = await factories(feeFetch, feePrevious).fees();
  assert.equal(fees.health.status, 'partial'); assert.equal(fees.l1PlusBlobLatestUsd, null); assert.equal(fees.annualizedFullFeesUsd, null);
  assert.equal(fees.cohortReviewRequired, true); assert.equal(fees.health.cohortId, 'execution+blob:arbitrum|base');
  const feesAgain = await factories(feeFetch, { auto: { fees } }).fees();
  assert.equal(feesAgain.health.status, 'partial'); assert.equal(feesAgain.annualizedFullFeesUsd, null);
});


test('malformed restaking arrays cannot become healthy zero TVL', async () => {
  const result = await factories(async () => good([])).restaking();
  assert.equal(result.totalUsd, null); assert.equal(result.health.status, 'failed');
});

test('sparse BTC history cannot masquerade as 90 daily paired returns', async () => {
  const fetchImpl = (url) => url.includes('/bitcoin/market_chart?')
    ? Promise.resolve(good({ prices: priceFixture('bitcoin').prices.filter((_, i) => i % 2 === 1) })) : marketFetch(url);
  const result = await factories(fetchImpl).market();
  assert.equal(result.correlation.now, null); assert.equal(result.correlation.coverage.dailyReturns, false);
});

test('shortened or sparse supply window cannot be called net30d or annualized', async () => {
  const short = [{ timestamp: '2026-10-04', supply: 120000000 }, { timestamp: '2026-10-05', supply: 120000010 }];
  const mock = async (url) => good(url.endsWith('/eth-supply-parts') ? { executionBalancesSum: '100000000000000000000000000', beaconBalancesSum: '30000000000000000', beaconDepositsSum: '10000000000000000' }
    : url.endsWith('/effective-balance-sum') ? { sum: '30000000000000000' }
      : url.endsWith('/supply-over-time') ? { d30: short, d7: short, since_merge: short }
        : url.endsWith('/burn-sums') ? { d30: { sum: { eth: 100 } } }
          : { issuance_per_slot_gwei: 1 });
  const result = await factories(mock).supply();
  assert.equal(result.net30dEth, null); assert.equal(result.net7dEth, null); assert.equal(result.issuance30dEth, null);
  assert.equal(result.windowCoverage.d30.complete, false); assert.equal(result.health.status, 'partial');
});

function allSourcesFixture(url) {
  if (url.includes('coingecko.com')) return marketFetch(url);
  if (url.includes('/aave-v3') || url.includes('/makerdao') || url.includes('morpho.org')) return collateralFetch(url);
  if (url.includes('stablecoinchains')) return Promise.resolve(good([
    { name: 'Ethereum', totalCirculatingUSD: { peggedUSD: 1000 } }, { name: 'Solana', totalCirculatingUSD: { peggedUSD: 500 } },
  ]));
  if (url.includes('/v2/chains')) return Promise.resolve(good([{ name: 'Ethereum', tvl: 1000 }, { name: 'Solana', tvl: 300 }]));
  if (url.includes('/overview/dexs')) return Promise.resolve(good({ total30d: url.includes('/ethereum?') ? 200 : url.includes('/solana?') ? 300 : 1000 }));
  if (url.endsWith('/protocols')) return Promise.resolve(good([{ name: 'ExampleRWA', slug: 'example-rwa', category: 'RWA', chainTvls: { Ethereum: 100 } }]));
  if (url.includes('/tvl/')) return Promise.resolve(good(100));
  if (url.includes('fundamentals.json')) return Promise.resolve(good(feeFixture()));
  if (url.includes('l2beat.com')) return Promise.resolve(good({ chart: { data: [[Date.parse('2026-10-05') / 1000, 100, 200, 300]] } }));
  if (url.endsWith('/eth-supply-parts')) return Promise.resolve(good({ executionBalancesSum: '100000000000000000000000000', beaconBalancesSum: '30000000000000000', beaconDepositsSum: '10000000000000000' }));
  if (url.endsWith('/effective-balance-sum')) return Promise.resolve(good({ sum: '30000000000000000' }));
  if (url.endsWith('/issuance-estimate')) return Promise.resolve(good({ issuance_per_slot_gwei: 1 }));
  if (url.endsWith('/burn-sums')) return Promise.resolve(good({ d30: { sum: { eth: 100 } }, since_merge: { sum: { eth: 1000 } } }));
  if (url.endsWith('/supply-over-time')) {
    const points = Array.from({ length: 31 }, (_, i) => ({ timestamp: new Date(Date.parse('2026-10-05') - (30 - i) * 86400000).toISOString(), supply: 120000000 + i }));
    return Promise.resolve(good({ d30: points, d7: points.slice(-8), since_merge: points }));
  }
  throw new Error(`Unexpected fixture endpoint: ${url}`);
}

test('full mocked production composition produces healthy evidence contract without claims', async () => {
  const snapshot = await buildSnapshot({ fetchImpl: allSourcesFixture, now: NOW, retries: 1, retryDelay: 0 });
  for (const [name, group] of Object.entries(snapshot.auto)) assert.equal(group.health.status, 'ok', `${name}: ${group.health.reason}`);
  assert.ok(snapshot.meta.sources.every((s) => s.status === 'ok'));
  assert.equal(snapshot.auto.eth.price, 2500); assert.equal(snapshot.auto.vol.quartersUnder50, null);
  assert.equal(snapshot.auto.collateral.morphoFinance.debtWeightedLltvPct, 86);
  assert.equal(snapshot.auto.supply.net30dEth, 30); assert.equal(snapshot.auto.supply.net7dEth, 7);
  assert.equal(snapshot.auto.restaking.totalUsd, 300); assert.equal(snapshot.auto.restaking.restakedEthEquivalent, null);
  assert.equal(snapshot.auto.restaking.underlyingEth, null); assert.equal(snapshot.auto.restaking.slashableEth, null);
  assert.equal(snapshot.auto.l2.health.observedAt, '2026-10-05T00:00:00.000Z');
  assert.equal(snapshot.auto.stablecoins.health.observedAt, null);
  assert.equal(snapshot.auto.fees.health.observedAt, '2026-10-05T00:00:00.000Z');
  assert.equal(snapshot.auto.eth.health.observedAt, NOW);
  const text = JSON.stringify(historyRow(snapshot));
  assert.doesNotMatch(text, /"(?:chiTotal|scores|p10k|p20k|branchPct|probabilities)"/);
});

test('production composition carries complete market and freezes partial cohorts without mixed-date ratios', async () => {
  const previous = await buildSnapshot({ fetchImpl: allSourcesFixture, now: NOW, retries: 1, retryDelay: 0 });
  const fetchImpl = (url) => url.includes('coingecko.com') || url.includes('morpho.org') || url.endsWith('/tvl/karak')
    ? Promise.resolve(fail) : allSourcesFixture(url);
  const snapshot = await buildSnapshot({ previous, fetchImpl, now: '2026-10-06T06:00:00.000Z', retries: 1, retryDelay: 0 });
  for (const key of ['eth', 'btc', 'ratio', 'vol', 'correlation']) assert.equal(snapshot.auto[key].health.status, 'stale', key);
  assert.equal(snapshot.auto.eth.price, previous.auto.eth.price);
  assert.equal(snapshot.auto.btc.price, previous.auto.btc.price);
  assert.deepEqual(snapshot.auto.ratio.series, previous.auto.ratio.series);
  assert.equal(snapshot.auto.vol.d365Pct, previous.auto.vol.d365Pct);
  assert.equal(snapshot.auto.correlation.now, previous.auto.correlation.now);
  assert.equal(snapshot.auto.collateral.health.status, 'stale');
  assert.equal(snapshot.auto.collateral.perVenue.length, 3); assert.equal(snapshot.auto.collateral.currentAttempt.perVenue.length, 2);
  assert.equal(snapshot.auto.restaking.health.status, 'stale'); assert.equal(snapshot.auto.restaking.totalUsd, 300);
  assert.equal(snapshot.auto.restaking.restakedEthEquivalent, null); assert.equal(snapshot.auto.fees.fullFeesToMarketCapPctPerYr, null);
  assert.equal(snapshot.auto.vol.rv365Persistence.status, 'unknown');
});

test('all-source failure returns explicit failed groups with no invented numerical headline', async () => {
  const snapshot = await buildSnapshot({ fetchImpl: noFetch, now: NOW, retries: 1, retryDelay: 0 });
  for (const [key, group] of Object.entries(snapshot.auto)) assert.equal(group.health.status, 'failed', key);
  assert.equal(snapshot.meta.sources.every((s) => s.status === 'failed'), true);
  const row = historyRow(snapshot);
  for (const key of ['ethUsd', 'ethBtc', 'vol365', 'restakingTvlUsd', 'l1FeesUsd', 'rwaTotalUsd', 'stakingPct']) assert.equal(row[key], null, key);
});


test('cross-DA costs cannot inflate reported Ethereum fees or paid-to-L1 ratios', async () => {
  const fixture = feeFixture().map((r) => r.metric_key.startsWith('costs_') ? { ...r, value: 1e12 } : r);
  const fetchImpl = (url) => url.includes('fundamentals.json') ? Promise.resolve(good(fixture)) : allSourcesFixture(url);
  const snapshot = await buildSnapshot({ fetchImpl, now: NOW, retries: 1, retryDelay: 0 });
  const f = snapshot.auto.fees;
  assert.equal(f.annualizedReportedL1FeesUsd, 36500); assert.equal(f.reportedL1FeesToMarketCapPctPerYr, 0.000012);
  assert.equal(f.annualizedFullFeesUsd, null); assert.equal(f.fullFeesToMarketCapPctPerYr, null);
  assert.equal(f.l1PlusBlobLatestUsd, null); assert.equal(f.blobRevLatestUsd, null);
  assert.equal(f.l2PaidToL1.currentRatioPct, null); assert.equal(f.rawFeeSeries.at(-1).reportedDaCostsUsd, 1e12);
  assert.match(f.fullFeesBasis, /Celestia and EigenDA/);
});


test('RV365 canonical daily sampling ignores duplicate and intraday points', async () => {
  const baseline = await factories(marketFetch).market();
  const fetchImpl = (url) => {
    if (!url.includes('/ethereum/market_chart?')) return marketFetch(url);
    const original = priceFixture('ethereum').prices;
    return Promise.resolve(good({ prices: original.flatMap(([t, p]) => [[t, p], [t, p], ...(t < Date.parse(NOW) ? [[t + 3600000, p * 3]] : [])]) }));
  };
  const result = await factories(fetchImpl).market();
  assert.equal(result.vol.d365Pct, baseline.vol.d365Pct); assert.equal(result.vol.d30Pct, baseline.vol.d30Pct);
  assert.equal(result.eth.priceSeries.length, baseline.eth.priceSeries.length);
  assert.ok(result.vol.sources.ethereumHistory.coverage.excludedIntradayOrDuplicate > 0);
});


test('explicit other-peg-only stablecoin maps are out of USD scope, empty/missing maps remain unknown', async () => {
  const rows = [{ name: 'Ethereum', totalCirculatingUSD: { peggedUSD: 100 } },
    { name: 'Concordium', totalCirculatingUSD: { peggedEUR: 0 } },
    { name: 'Secret', totalCirculatingUSD: { peggedVAR: 0 } },
    { name: 'Q Protocol', totalCirculatingUSD: { peggedCHF: 0, peggedEUR: .00001 } }];
  const result = await factories(async () => good(rows)).stablecoins();
  assert.equal(result.health.status, 'ok'); assert.equal(result.totalUsd, 100); assert.equal(result.ethSharePct, 100);
  assert.equal(result.byChain.find((r) => r.name === 'Concordium').usd, null);
  assert.equal(result.health.coverage.excludedNonUsdChains.length, 3);
  for (const totalCirculatingUSD of [{}, { peggedUSD: null, peggedEUR: 0 }, undefined]) {
    const bad = await factories(async () => good([...rows, { name: 'Unknown', totalCirculatingUSD }])).stablecoins();
    assert.equal(bad.health.status, 'partial'); assert.equal(bad.totalUsd, null);
  }
});

test('legacy successful request time survives carry as lastSuccessAt, never observedAt', async () => {
  const previous = { auto: { eth: { price: 2500 }, btc: { price: 60000 }, ratio: { now: .04 }, vol: { d365Pct: 50 }, correlation: { now: .8 }, _market: { asOf: '2026-10-05T20:00:00Z' } },
    meta: { sources: [{ key: 'coingecko', ok: true, asOf: '2026-10-05T20:00:00Z' }] } };
  const result = await factories(noFetch, previous).market();
  assert.equal(result.eth.health.lastSuccessAt, '2026-10-05T20:00:00.000Z'); assert.equal(result.eth.health.observedAt, null);
});


test('unrelated missing Morpho valuations do not invalidate a complete explicit finance cohort', async () => {
  const unrelated = { marketId: 'other-usdc', listed: true, lltv: '800000000000000000', loanAsset: { symbol: 'USDC' }, collateralAsset: { symbol: 'OTHER' }, state: { collateralAssetsUsd: null, borrowAssetsUsd: 10 } };
  const fetchImpl = (url) => url.includes('morpho.org') ? Promise.resolve(good({ data: { markets: { items: [...morphoMarkets, unrelated] } } })) : collateralFetch(url);
  const result = await factories(fetchImpl).collateral();
  assert.equal(result.health.status, 'partial'); assert.equal(result.morphoFinance.health.status, 'ok');
  assert.equal(result.morphoFinance.debtWeightedLltvPct, 86); assert.equal(result.morphoFinance.totalBorrowUsd, 100);
  assert.equal(result.perVenue.find((v) => v.name === 'Morpho').totalUsd, null);
});


test('impossible calendar dates and timestamp coercions never become observations', () => {
  for (const value of ['2026-02-31', '2026-04-31T00:00:00Z', '2026-10-05T24:00:00Z', '2025-02-29', ['2026-10-05'], true, {}]) {
    assert.equal(observationTime(value, NOW), null, JSON.stringify(value));
  }
  assert.equal(observationTime('2024-02-29', NOW), '2024-02-29T00:00:00.000Z');
  assert.equal(observationTime('2026-10-05T12:30:01.234Z', NOW), '2026-10-05T12:30:01.234Z');
});
