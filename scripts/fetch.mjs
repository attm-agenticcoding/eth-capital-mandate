// Evidence-first ingestion. Importing this module performs no requests or writes.
// The six-hour workflow still runs `node scripts/fetch.mjs`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ETH_ALIGNED_CHAINS, ETH_ALIGNED_CHAINS_STRICT } from '../src/lib/kill.mjs';
import { drawdownPctFromAth, alignmentGapPp } from '../src/lib/market.mjs';
import { SCHEMA_VERSION, METHODOLOGY_VERSION, DAY_MS, numberOrNull as num, round, sumComplete,
  percent, observationTime, oldestObservation, makeHealth, groupHealth, stamp, preserveCohort, rv365Persistence } from '../src/lib/fetch-health.mjs';
export { SCHEMA_VERSION, METHODOLOGY_VERSION };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKET_KEYS = ['eth', 'btc', 'ratio', 'vol', 'correlation'];
const ETH_SET = new Set(['ETH', 'WETH', 'STETH', 'WSTETH', 'WEETH', 'RETH', 'CBETH', 'ETHX', 'EZETH', 'OSETH', 'RSETH', 'TETH', 'SFRXETH', 'FRXETH', 'METH', 'CMETH', 'SWETH', 'RSWETH', 'PUFETH', 'LSETH', 'OETH', 'UNIETH', 'ANKRETH', 'MSETH', 'WBETH', 'EETH', 'APXETH', 'PXETH', 'YNETH', 'INETH', 'WOETH']);
const BTC_SET = new Set(['BTC', 'WBTC', 'CBBTC', 'TBTC', 'LBTC', 'EBTC', 'FBTC', 'BTCB', 'SOLVBTC', 'KBTC', 'PUMPBTC', 'UNIBTC', 'SWBTC', 'XBTC', 'BTC.B']);
// Explicit USD assets only. Gold and EUR assets are not USD stable financing.
const USD_SET = new Set(['DAI', 'GHO', 'FRAX', 'LUSD', 'SDAI', 'SUSDS', 'SUSDE', 'USDE', 'RLUSD', 'PYUSD', 'TUSD', 'CRVUSD', 'GUSD', 'FDUSD', 'USDD', 'MUSD', 'EUSDE', 'USD0', 'USDG', 'USDTB', 'SYRUPUSDT', 'USDS', 'USDC', 'USDT']);
export function classifyToken(raw) {
  const s = String(raw || '').toUpperCase();
  if (ETH_SET.has(s)) return 'eth';
  if (BTC_SET.has(s)) return 'btc';
  if (USD_SET.has(s)) return 'stable';
  return 'other';
}
export function bucketize(tokens) {
  if (!tokens || typeof tokens !== 'object' || !Object.keys(tokens).length) return null;
  const result = { eth: 0, stable: 0, btc: 0, other: 0 };
  for (const [symbol, value] of Object.entries(tokens)) {
    const n = num(value);
    if (n === null || n < 0) return null;
    result[classifyToken(symbol)] += n;
  }
  return result;
}
const totalBuckets = (b) => b ? sumComplete(Object.values(b)) : null;
const mean = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
const annVol = (a) => a.length >= 2 ? Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)) * 365) * 100 : null;
const logReturns = (p) => p.slice(1).map((v, i) => Math.log(v / p[i]));
const downsample = (rows, limit = 160) => rows.length <= limit ? rows : rows.filter((_, i) => i % Math.ceil(rows.length / (limit - 1)) === 0 || i === rows.length - 1);
function pearson(x, y) {
  if (x.length !== y.length || x.length < 3) return null;
  const a = x.map((v) => v - mean(x)), b = y.map((v) => v - mean(y));
  const d = Math.sqrt(a.reduce((s, v) => s + v * v, 0) * b.reduce((s, v) => s + v * v, 0));
  return d > 0 ? a.reduce((s, v, i) => s + v * b[i], 0) / d : null;
}
const errorText = (e) => e instanceof Error ? e.message : String(e);
const nonnegative = (value) => num(value) !== null && num(value) >= 0 ? num(value) : null;
const requireArray = (value, label) => { if (!Array.isArray(value) || !value.length) throw new Error(`${label}: empty or invalid response`); return value; };
const requireNumber = (value, label) => { const n = nonnegative(value); if (n === null) throw new Error(`${label}: missing or invalid numeric value`); return n; };

export function createFetchers({ fetchImpl = globalThis.fetch, now = new Date().toISOString(), previous = {}, retries = 2, retryDelay = 500 } = {}) {
  now = new Date(now).toISOString();
  const sources = {};
  async function json(url, { timeout = 45000, ...options } = {}) {
    let last;
    for (let attempt = 0; attempt < retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        const response = await fetchImpl(url, { ...options, signal: ctrl.signal,
          headers: { accept: 'application/json', 'user-agent': 'eth-evidence/2.0', ...options.headers } });
        if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
        return await response.json();
      } catch (e) { last = e; }
      finally { clearTimeout(timer); }
      if (attempt + 1 < retries && retryDelay) await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
    throw last;
  }
  async function source(key, url, fn, ttlHours = 48) {
    const old = previous.meta?.sources?.find((s) => s.key === key);
    try {
      const result = await fn();
      const health = makeHealth({ now, status: result.status || 'ok', observedAt: result.observedAt ?? null,
        previous: old?.health || old, ttlHours, reason: result.reason ?? null, coverage: result.coverage ?? null, cohortId: result.cohortId ?? null });
      sources[key] = { key, label: key, url, ...health, health, ok: health.status === 'ok', asOf: health.observedAt };
      return { ...result, health };
    } catch (e) {
      const health = makeHealth({ now, status: 'failed', previous: old?.health || old, ttlHours, reason: errorText(e) });
      sources[key] = { key, label: key, url, ...health, health, ok: false, asOf: null };
      return { data: null, health };
    }
  }
  const healths = (...results) => Object.fromEntries(results.map(([key, r]) => [key, r.health]));
  function finish(group, data, perSource, opts = {}) {
    const health = groupHealth(perSource, { now, previous: previous.auto?.[group]?.health, ...opts });
    return stamp(data, health, perSource);
  }
  function carry(group, current) {
    const prior = previous.auto?.[group];
    if (!prior) return current;
    const marketSource = previous.meta?.sources?.find((s) => s.key === 'coingecko');
    const legacySuccess = !previous.schemaVersion ? MARKET_KEYS.includes(group)
      ? (marketSource?.ok ? marketSource.asOf : previous.auto?._market?.asOf) : prior.asOf : null;
    const health = { ...current.health, status: 'stale', observedAt: observationTime(prior.health?.observedAt, now),
      lastSuccessAt: prior.health?.lastSuccessAt ?? observationTime(legacySuccess, now) ?? null,
      reason: `Carried last available values: ${current.health.reason || 'upstream unavailable'}` };
    return stamp(sanitizeLegacy(group, prior), health, current.sources);
  }
  async function market() {
    const m = await source('coingecko_markets', 'https://www.coingecko.com', async () => {
      const all = requireArray(await json('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=ethereum,bitcoin&price_change_percentage=24h'), 'markets');
      const eth = all.find((r) => r.id === 'ethereum'), btc = all.find((r) => r.id === 'bitcoin');
      requireNumber(eth?.current_price, 'ETH price'); requireNumber(btc?.current_price, 'BTC price');
      if (eth.current_price <= 0 || btc.current_price <= 0) throw new Error('Invalid nonpositive market price');
      for (const row of [eth, btc]) if (row.last_updated && !observationTime(row.last_updated, now)) throw new Error('Invalid or future market observation');
      return { data: { eth, btc }, observedAt: oldestObservation([eth.last_updated, btc.last_updated], now) };
    }, 24);
    const chart = async (asset) => source(`coingecko_${asset}_history`, 'https://www.coingecko.com', async () => {
      const result = await json(`https://api.coingecko.com/api/v3/coins/${asset}/market_chart?vs_currency=usd&days=365&interval=daily`);
      const raw = requireArray(result.prices, `${asset} history`);
      const valid = raw.filter((p) => observationTime(p[0], now) && num(p[1]) > 0).sort((a, b) => a[0] - b[0]);
      const daily = new Map();
      for (const p of valid) {
        const day = new Date(p[0]).toISOString().slice(0, 10);
        // First real point per UTC day. A non-midnight live point for today's
        // unfinished day is omitted rather than becoming an extra daily return.
        if (day === now.slice(0, 10) && p[0] - Date.parse(day) >= 60000) continue;
        if (!daily.has(day)) daily.set(day, p);
      }
      const data = [...daily.values()];
      if (data.length < 2) throw new Error('Insufficient nonfuture daily price observations');
      return { data, observedAt: data.at(-1)[0], status: valid.length === raw.length ? 'ok' : 'partial',
        reason: valid.length === raw.length ? null : 'Invalid/future price points excluded', coverage: { received: raw.length, usable: data.length,
          excludedIntradayOrDuplicate: valid.length - data.length, sampling: 'First genuine observation per UTC day; unfinished current-day intraday point excluded' } };
    }, 48);
    const [e, b] = await Promise.all([chart('ethereum'), chart('bitcoin')]);
    const ps = healths(['markets', m], ['ethereumHistory', e], ['bitcoinHistory', b]);
    const group = finish('_market', {}, ps);
    if (!m.data || !e.data || !b.data || group.health.status !== 'ok') {
      const result = {};
      for (const key of MARKET_KEYS) result[key] = carry(key, stamp({}, group.health, ps));
      return { ...result, _market: stamp({}, { ...group.health, status: MARKET_KEYS.every((k) => previous.auto?.[k]) ? 'stale' : group.health.status }, ps) };
    }
    const { eth, btc } = m.data;
    const er = logReturns(e.data.map((p) => p[1]));
    const dayMap = (data) => new Map(data.map(([t, v]) => [new Date(t).toISOString().slice(0, 10), [t, v]]));
    const em = dayMap(e.data), bm = dayMap(b.data);
    const aligned = [...em.entries()].filter(([d]) => bm.has(d)).map(([d, [t, ep]]) => [t, ep, bm.get(d)[1]]);
    const ae = logReturns(aligned.map((p) => p[1])), ab = logReturns(aligned.map((p) => p[2]));
    const coverageDays = (e.data.at(-1)[0] - e.data[0][0]) / DAY_MS;
    const maxGapDays = Math.max(...e.data.slice(1).map((p, i) => (p[0] - e.data[i][0]) / DAY_MS));
    const daily = maxGapDays <= 1.5;
    const pairedMaxGapDays = aligned.length > 1 ? Math.max(...aligned.slice(1).map((p, i) => (p[0] - aligned[i][0]) / DAY_MS)) : Infinity;
    const pairedDaily = aligned.length >= 91 && pairedMaxGapDays <= 1.5;
    const qVols = [];
    for (let end = er.length; end >= 91; end -= 91) qVols.push(round(annVol(er.slice(end - 91, end)), 1));
    const volSeries = er.slice(29).map((_, i) => ({ t: e.data[i + 30][0], v: round(annVol(er.slice(i, i + 30)), 1) }));
    const corrSeries = ae.slice(89).map((_, i) => ({ t: aligned[i + 90][0], v: round(pearson(ae.slice(i, i + 90), ab.slice(i, i + 90)), 4) }));
    const values = {
      eth: { price: round(eth.current_price), mcap: nonnegative(eth.market_cap), change24hPct: round(eth.price_change_percentage_24h),
        ath: nonnegative(eth.ath), athChangePct: round(eth.ath_change_percentage), circulating: nonnegative(eth.circulating_supply),
        drawdownFromPeakPct: round(drawdownPctFromAth(eth.current_price, eth.ath), 1),
        drawdownFrom365dHighPct: round((1 - eth.current_price / Math.max(...e.data.map((p) => p[1]))) * 100, 1),
        priceSeries: downsample(e.data.map(([t, v]) => ({ t, v: round(v) }))) },
      btc: { price: round(btc.current_price), mcap: nonnegative(btc.market_cap) },
      ratio: { now: round(eth.current_price / btc.current_price, 6), series: downsample(aligned.map(([t, ep, bp]) => ({ t, v: round(ep / bp, 6) }))) },
      vol: { d30Pct: daily && er.length >= 30 ? round(annVol(er.slice(-30)), 1) : null,
        d365Pct: daily && coverageDays >= 364 && er.length >= 364 ? round(annVol(er), 1) : null,
        quartersUnder50: null, quarterVols: daily ? qVols : [], quarterVolsBasis: 'Descriptive consecutive 91-return realized-volatility blocks, not RV365 persistence',
        rv365Persistence: { status: 'unknown', belowThreshold: null }, series: daily ? downsample(volSeries) : [], coverage: { elapsedDays: round(coverageDays), maxGapDays: round(maxGapDays) } },
      correlation: { now: pairedDaily ? corrSeries.at(-1)?.v ?? null : null, series: pairedDaily ? downsample(corrSeries) : [],
        coverage: { pairedObservations: aligned.length, pairedMaxGapDays: Number.isFinite(pairedMaxGapDays) ? round(pairedMaxGapDays) : null, dailyReturns: pairedDaily } },
    };
    return { ...Object.fromEntries(MARKET_KEYS.map((key) => [key, stamp(values[key], ['eth', 'btc'].includes(key)
      ? { ...group.health, observedAt: observationTime(m.data[key].last_updated, now) } : group.health, ps)])), _market: group };
  }
  async function collateral() {
    const venue = (key, slugs) => source(`collateral_${key}`, `https://defillama.com/protocol/${slugs[0]}`, async () => {
      let last;
      for (const slug of slugs) {
        try {
          const p = await json(`https://api.llama.fi/protocol/${slug}`);
          const points = requireArray(p?.chainTvls?.Ethereum?.tokensInUsd, `${key} token balances`)
            .filter((p) => observationTime(p.date, now)).sort((a, b) => a.date - b.date);
          const point = points.at(-1), buckets = bucketize(point?.tokens);
          if (!buckets) throw new Error(`${key}: missing valid token balances`);
          return { data: { name: key, slug, basis: 'pool composition proxy; not borrower collateral', buckets,
            totalUsd: round(totalBuckets(buckets)), ethSharePct: percent(buckets.eth, totalBuckets(buckets), 1), observedAt: observationTime(point.date, now) }, observedAt: point.date };
        } catch (e) { last = e; }
      }
      throw last;
    });
    const morpho = () => source('collateral_Morpho', 'https://blue-api.morpho.org/graphql', async () => {
      const markets = [];
      for (let skip = 0; ; skip += 200) {
        if (skip >= 10000) throw new Error('Morpho pagination safety limit; cohort incomplete');
        const query = `{ markets(first: 200, skip: ${skip}, where: { chainId_in: [1], listed: true }, orderBy: SupplyAssetsUsd, orderDirection: Desc) { items { marketId listed lltv loanAsset { symbol } collateralAsset { symbol } state { timestamp collateralAssetsUsd borrowAssetsUsd } } } }`;
        const j = await json('https://blue-api.morpho.org/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
        if (j.errors) throw new Error(`Morpho schema: ${JSON.stringify(j.errors).slice(0, 200)}`);
        if (!Array.isArray(j.data?.markets?.items)) throw new Error('Morpho markets schema missing');
        const page = j.data.markets.items;
        markets.push(...page);
        if (page.length < 200) break;
      }
      if (!markets.length) throw new Error('Morpho empty market cohort');
      const parsed = markets.filter((m) => m.listed && m.collateralAsset).map((m) => ({
        id: m.marketId ?? null, observedAt: observationTime(num(m.state?.timestamp), now), collateralSymbol: m.collateralAsset.symbol ?? null, loanSymbol: m.loanAsset?.symbol ?? null,
        collateralUsd: nonnegative(m.state?.collateralAssetsUsd), borrowUsd: nonnegative(m.state?.borrowAssetsUsd),
        lltvPct: num(m.lltv) !== null && num(m.lltv) >= 0 && num(m.lltv) <= 1e18 ? round(num(m.lltv) / 1e18 * 100, 6) : null,
      }));
      const identityValid = new Set(parsed.map((m) => m.id)).size === parsed.length && parsed.every((m) => m.id && m.collateralSymbol && m.loanSymbol);
      const amountsValid = (m) => m.collateralUsd !== null && m.borrowUsd !== null && m.lltvPct !== null;
      const valid = identityValid && parsed.every(amountsValid);
      const eligible = parsed.filter((m) => classifyToken(m.collateralSymbol) === 'eth' && USD_SET.has(String(m.loanSymbol).toUpperCase()));
      const financeValid = identityValid && eligible.every(amountsValid);
      const financeCohortId = eligible.map((m) => m.id).filter(Boolean).sort().join('|');
      const financeObservedAt = oldestObservation(eligible.map((m) => m.observedAt), now);
      const financeHealth = makeHealth({ now, status: financeValid ? 'ok' : 'partial', observedAt: financeObservedAt, ttlHours: 48,
        previous: previous.auto?.collateral?.morphoFinance?.health, cohortId: financeCohortId,
        reason: financeValid ? null : 'Eligible ETH/USD-stable market identity or balances unavailable',
        coverage: { expected: eligible.length, received: eligible.filter(amountsValid).length } });
      const totalBorrowUsd = financeValid ? eligible.length ? sumComplete(eligible.map((m) => m.borrowUsd)) : 0 : null;
      const totalCollateralUsd = financeValid ? eligible.length ? sumComplete(eligible.map((m) => m.collateralUsd)) : 0 : null;
      const weighted = financeValid && totalBorrowUsd > 0 ? eligible.reduce((s, m) => s + m.lltvPct * m.borrowUsd, 0) / totalBorrowUsd : null;
      const max = financeValid && eligible.some((m) => m.borrowUsd > 0) ? Math.max(...eligible.filter((m) => m.borrowUsd > 0).map((m) => m.lltvPct)) : null;
      const buckets = valid && parsed.length ? { eth: 0, stable: 0, btc: 0, other: 0 } : null;
      if (buckets) for (const m of parsed) buckets[classifyToken(m.collateralSymbol)] += m.collateralUsd;
      return { data: { name: 'Morpho', slug: 'morpho-blue', basis: 'listed-market collateral USD composition; not a borrower-netted cross-protocol aggregate',
        buckets, totalUsd: round(totalBuckets(buckets)), ethSharePct: buckets ? percent(buckets.eth, totalBuckets(buckets), 1) : null,
        finance: { scope: 'Ethereum listed markets: ETH-family collateral and explicit USD-stable loan assets',
          totalBorrowUsd, totalCollateralUsd, eligibleMarketCount: financeValid ? eligible.length : null, health: financeHealth, observedAt: financeObservedAt,
          borrowWeightedLltvPct: round(weighted, 3), debtWeightedLltvPct: round(weighted, 3), marketCount: financeValid ? eligible.length : null,
          cohortId: financeCohortId, morphoExtremeMaxLltvPct: max,
          maxLltvLabel: 'Morpho extreme LLTV among eligible markets with borrowing; not an Aave haircut', markets: eligible }, markets: parsed },
        status: valid ? 'ok' : 'partial', reason: valid ? null : 'All-market composition incomplete; eligible ETH/USD-stable finance has separate health',
        observedAt: oldestObservation(parsed.map((m) => m.observedAt), now), coverage: { listedMarkets: parsed.length, eligibleMarkets: eligible.length, validContract: valid } };
    });
    const [a, s, m] = await Promise.all([venue('Aave', ['aave-v3']), venue('Sky', ['makerdao', 'sky']), morpho()]);
    const cohortId = 'aave-v3+morpho-blue+sky:ethereum:v2';
    const perSource = healths(['aave', a], ['morpho', m], ['sky', s]);
    const current = finish('collateral', {
      combinedEthSharePct: null, combinedStableSharePct: null, combinedTotalUsd: null, combinedEthShareDeltaPp: null,
      drift: [], driftWindowMonths: null, venuesUsed: [a, m, s].filter((r) => r.data).map((r) => r.data.name),
      perVenue: [a, m, s].filter((r) => r.data).map((r) => ({ ...r.data, health: r.health })),
      morphoFinance: m.data?.finance ?? null, morphoOk: m.health.status === 'ok',
      method: 'Per-venue contextual composition only. Aave/Sky pool balances are proxies, not true collateral. No mixed-basis aggregate or historical Morpho backfill.',
    }, perSource, { cohortId, coverage: { expected: 3, received: [a, m, s].filter((r) => r.health.status === 'ok').length } });
    return preserveCohort(current, previous.auto?.collateral, { now, cohortId,
      aggregateKeys: ['combinedEthSharePct', 'combinedStableSharePct', 'combinedTotalUsd', 'combinedEthShareDeltaPp'] });
  }
  async function restaking() {
    const slugs = ['eigenlayer', 'symbiotic', 'karak'];
    const results = await Promise.all(slugs.map((slug) => source(`restaking_${slug}`, `https://defillama.com/protocol/${slug}`, async () => {
      const value = await json(`https://api.llama.fi/tvl/${slug}`);
      return { data: requireNumber(value, `${slug} TVL`), observedAt: null };
    })));
    const cohortId = 'eigenlayer+symbiotic+karak:usd-tvl:v2';
    const complete = results.every((r) => r.health.status === 'ok');
    const current = finish('restaking', { totalUsd: complete ? round(sumComplete(results.map((r) => r.data)), 0) : null,
      byProtocol: Object.fromEntries(slugs.map((s, i) => [s, round(results[i].data, 0)])),
      restakedEthEquivalent: null, underlyingEth: null, slashableEth: null, paidAvsRevenueUsd: null,
      method: 'Protocol USD TVL context. USD divided by ETH price is an ETH-equivalent only; token composition and slashable security are not measured.' },
    Object.fromEntries(slugs.map((s, i) => [s, results[i].health])), { cohortId, coverage: { expected: 3, received: results.filter((r) => r.health.status === 'ok').length } });
    return preserveCohort(current, previous.auto?.restaking, { now, cohortId, aggregateKeys: ['totalUsd', 'restakedEthEquivalent'] });
  }
  function alignedShares(rows, total) {
    const broad = new Set(ETH_ALIGNED_CHAINS), strict = new Set(ETH_ALIGNED_CHAINS_STRICT);
    const aligned = (set) => sumComplete(rows.filter((r) => set.has(r.name)).map((r) => r.usd));
    const broadPct = percent(aligned(broad), total, 1), strictPct = percent(aligned(strict), total, 1);
    return { ethAlignedUsd: aligned(broad), ethAlignedSharePct: broadPct, ethAlignedSharePctBroad: broadPct,
      ethAlignedSharePctStrict: strictPct, ethAlignedBroadMinusStrictPp: alignmentGapPp(broadPct, strictPct) };
  }
  async function stablecoins() {
    const r = await source('defillama_stables', 'https://defillama.com/stablecoins', async () => {
      const arr = requireArray(await json('https://stablecoins.llama.fi/stablecoinchains'), 'stablecoin chains');
      const rows = arr.map((r) => {
        const balances = r.totalCirculatingUSD, entries = balances && typeof balances === 'object' && !Array.isArray(balances) ? Object.entries(balances) : [];
        // Official craftStablecoinChainsResponse builds a sparse pegType map.
        // A populated map containing only other pegs is explicitly out of the USD scope, not a missing USD balance to coerce to zero.
        const nonUsdOnly = entries.length > 0 && !Object.hasOwn(balances, 'peggedUSD')
          && entries.every(([peg, amount]) => /^pegged[A-Z]+$/.test(peg) && nonnegative(amount) !== null);
        return { name: r.name, usd: nonnegative(balances?.peggedUSD), usdScope: nonUsdOnly ? 'non-usd-only' : 'usd-or-unknown' };
      });
      const usdRows = rows.filter((r) => r.usdScope !== 'non-usd-only');
      const observedCohortId = rows.map((r) => r.name).sort().join('|');
      const expectedCohortId = previous.auto?.stablecoins?.health?.cohortId || observedCohortId;
      const cohortChanged = expectedCohortId !== observedCohortId;
      const total = cohortChanged ? null : sumComplete(usdRows.map((r) => r.usd));
      const eth = rows.find((r) => r.name === 'Ethereum')?.usd ?? null;
      return { data: { observedCohortId, cohortChanged, cohortReviewRequired: cohortChanged, totalUsd: total, ethUsd: eth, ethSharePct: percent(eth, total, 1), ...alignedShares(usdRows, total),
        scope: 'USD-pegged stablecoins only; explicit other-peg-only maps excluded',
        scopeSource: 'https://github.com/DefiLlama/peggedassets-server/blob/master/api2/cron-task/getStablecoinChains.ts',
        byChain: rows.map((r) => ({ ...r, sharePct: percent(r.usd, total, 1) })).sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1)) },
      observedAt: null, status: total === null ? 'partial' : 'ok', reason: cohortChanged ? 'Chain cohort changed; review required before new denominator is accepted' : total === null ? 'Missing chain balances; denominator withheld' : null,
      cohortId: expectedCohortId, coverage: { expected: usdRows.length, received: usdRows.filter((r) => r.usd !== null).length,
        responseChains: rows.length, excludedNonUsdChains: rows.filter((r) => r.usdScope === 'non-usd-only').map((r) => r.name) } };
    });
    const current = finish('stablecoins', r.data || {}, healths(['defillama', r]), { cohortId: r.cohortId, coverage: r.coverage });
    return r.data ? current : carry('stablecoins', current);
  }
  async function chains() {
    const tvl = await source('defillama_chains', 'https://defillama.com/chains', async () => {
      const arr = requireArray(await json('https://api.llama.fi/v2/chains'), 'chain TVLs');
      const rows = arr.map((r) => ({ name: r.name, tvl: nonnegative(r.tvl) }));
      const totalTvl = sumComplete(rows.map((r) => r.tvl));
      const ethTvl = rows.find((r) => r.name === 'Ethereum')?.tvl ?? null;
      const solanaTvl = rows.find((r) => r.name === 'Solana')?.tvl ?? null;
      return { data: { ethTvl, solanaTvl, totalTvl, ethSharePct: percent(ethTvl, totalTvl, 1), solanaSharePct: percent(solanaTvl, totalTvl, 1) },
        observedAt: null, status: totalTvl === null ? 'partial' : 'ok', reason: totalTvl === null ? 'Missing chain balances' : null };
    });
    const dex = await Promise.all(['', 'ethereum', 'solana'].map((slug) => source(`dex_${slug || 'all'}`, 'https://defillama.com/dexs', async () => {
      const r = await json(`https://api.llama.fi/overview/dexs${slug ? '/' + slug : ''}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`);
      return { data: requireNumber(r.total30d, 'DEX volume'), observedAt: null };
    })));
    const ps = { ...healths(['chainTvl', tvl]), ...Object.fromEntries(['dexAll', 'dexEthereum', 'dexSolana'].map((key, i) => [key, dex[i].health])) };
    const current = finish('chains', { ...(tvl.data || {}), dexVolTotal30dUsd: dex[0].data, ethDexVol30dUsd: dex[1].data,
      solDexVol30dUsd: dex[2].data, ethDexVolSharePct: percent(dex[1].data, dex[0].data, 1), solDexVolSharePct: percent(dex[2].data, dex[0].data, 1), dexVolWindow: '30d' }, ps);
    return !tvl.data && dex.every((r) => r.data === null) ? carry('chains', current) : current;
  }
  async function rwa() {
    const r = await source('defillama_rwa', 'https://defillama.com/protocols/RWA', async () => {
      const all = requireArray(await json('https://api.llama.fi/protocols'), 'protocol list');
      const cohort = all.filter((p) => p.category === 'RWA');
      if (!cohort.length) throw new Error('RWA category has no protocols');
      const byChain = {}, ids = [], invalid = [];
      for (const p of cohort) {
        ids.push(String(p.slug || p.id || p.name));
        if (!p.chainTvls || !Object.keys(p.chainTvls).length) { invalid.push(p.name); continue; }
        for (const [chain, value] of Object.entries(p.chainTvls)) {
          if (chain.includes('-') || ['borrowed', 'staking', 'pool2', 'treasury'].includes(chain)) continue;
          const n = nonnegative(value);
          if (n === null) invalid.push(`${p.name}:${chain}`);
          else byChain[chain] = (byChain[chain] ?? 0) + n;
        }
      }
      const rows = Object.entries(byChain).map(([name, usd]) => ({ name, usd }));
      const totalUsd = invalid.length ? null : sumComplete(rows.map((r) => r.usd));
      const ethUsd = byChain.Ethereum ?? null;
      const previousTotal = previous.auto?.rwa?.totalUsd;
      const stockChangePct = num(previousTotal) > 0 && totalUsd !== null ? (totalUsd / previousTotal - 1) * 100 : null;
      const cohortId = ids.sort().join('|');
      const cohortChanged = previous.auto?.rwa?.health?.cohortId ? previous.auto.rwa.health.cohortId !== cohortId : null;
      return { data: { totalUsd, ethUsd, ethSharePct: percent(ethUsd, totalUsd, 1), ...alignedShares(rows, totalUsd),
        byChain: rows.map((r) => ({ ...r, sharePct: percent(r.usd, totalUsd, 1) })).sort((a, b) => b.usd - a.usd),
        stockChangePct: round(stockChangePct), manualReviewRequired: stockChangePct !== null && Math.abs(stockChangePct) > 30,
        cohortChanged, newIssuanceUsd: null,
        limitations: 'DefiLlama RWA-category TVL stock; category/schema/cohort and valuation changes affect differences. Stock change is not new issuance.' },
        observedAt: null, status: invalid.length ? 'partial' : 'ok', reason: invalid.length ? 'Incomplete RWA balances; total withheld' : null,
        cohortId, coverage: { protocols: cohort.length, invalidFields: invalid.length } };
    });
    const current = finish('rwa', r.data || {}, healths(['defillama', r]), { cohortId: r.cohortId, coverage: r.coverage });
    return r.data ? current : carry('rwa', current);
  }
  async function supply() {
    const endpoints = ['eth-supply-parts', 'effective-balance-sum', 'supply-over-time', 'burn-sums', 'issuance-estimate'];
    const results = await Promise.all(endpoints.map((endpoint) => source(`ultrasound_${endpoint}`, 'https://ultrasound.money', async () => {
      const data = await json(`https://ultrasound.money/api/v2/fees/${endpoint}`);
      if (!data || typeof data !== 'object') throw new Error('Invalid supply response');
      let stampValue = data.timestamp ?? data.updatedAt ?? null;
      if (endpoint === 'eth-supply-parts' && ['executionBalancesSum', 'beaconBalancesSum', 'beaconDepositsSum'].some((k) => num(data[k]) === null)) throw new Error('Missing supply-part balance');
      if (endpoint === 'effective-balance-sum' && num(data.sum) === null) throw new Error('Missing effective staking balance');
      if (endpoint === 'issuance-estimate' && num(data.issuance_per_slot_gwei) === null) throw new Error('Missing issuance estimate');
      if (endpoint === 'supply-over-time') {
        const valid = [...(data.d30 || []), ...(data.d7 || []), ...(data.since_merge || [])].map((p) => observationTime(p.timestamp, now)).filter(Boolean).sort();
        if (!valid.length) throw new Error('Missing nonfuture supply history');
        stampValue = valid.at(-1);
      }
      return { data, observedAt: stampValue };
    })));
    const [p, e, s, b, i] = results.map((r) => r.data || {});
    const exec = num(p.executionBalancesSum), beacon = num(p.beaconBalancesSum), deposits = num(p.beaconDepositsSum);
    const total = [exec, beacon, deposits].every((v) => v !== null) ? exec / 1e18 + (beacon - deposits) / 1e9 : null;
    const actual = beacon === null ? null : beacon / 1e9;
    const effective = num(e.sum) === null ? null : num(e.sum) / 1e9;
    const window = (rows) => Array.isArray(rows) ? rows.filter((r) => observationTime(r.timestamp, now) && num(r.supply) !== null).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)) : [];
    const windowCoverage = (rows, days) => {
      const a = window(rows);
      const elapsedDays = a.length >= 2 ? (Date.parse(a.at(-1).timestamp) - Date.parse(a[0].timestamp)) / DAY_MS : null;
      const maxGapDays = a.length >= 2 ? Math.max(...a.slice(1).map((p, j) => (Date.parse(p.timestamp) - Date.parse(a[j].timestamp)) / DAY_MS)) : null;
      return { observations: a.length, elapsedDays, maxGapDays, complete: elapsedDays !== null && elapsedDays >= days - 1 && elapsedDays <= days + 1 && maxGapDays <= 2 };
    };
    const delta = (rows, days = null) => { const a = window(rows); return a.length >= 2 && (days === null || windowCoverage(rows, days).complete) ? a.at(-1).supply - a[0].supply : null; };
    const net30dEth = delta(s.d30, 30), burn30dEth = nonnegative(b.d30?.sum?.eth);
    const data = { totalSupplyEth: round(total, 0), stakedEth: round(actual, 0), stakedEffectiveEth: round(effective, 0),
      stakingPct: percent(actual, total, 1), net30dEth: round(net30dEth, 0), net7dEth: round(delta(s.d7, 7), 0), sinceMergeEth: round(delta(s.since_merge), 0),
      burn30dEth: round(burn30dEth, 0), burnSinceMergeEth: round(nonnegative(b.since_merge?.sum?.eth), 0),
      issuance30dEth: round(sumComplete([net30dEth, burn30dEth]), 0),
      issuanceGrossPerYrEth: num(i.issuance_per_slot_gwei) === null ? null : round(num(i.issuance_per_slot_gwei) / 1e9 * 365.25 * 86400 / 12, 0),
      deflationary: net30dEth === null ? null : net30dEth < 0,
      windowCoverage: { d30: windowCoverage(s.d30, 30), d7: windowCoverage(s.d7, 7) },
      supplySeries: downsample(window(s.since_merge).map((r) => ({ t: Date.parse(r.timestamp), v: round(r.supply, 0) }))) };
    const current = finish('supply', data, Object.fromEntries(endpoints.map((key, index) => [key, results[index].health])));
    if ((total === null || net30dEth === null) && current.health.status === 'ok') current.health = { ...current.health, status: 'partial', reason: 'Supply balance or complete 30-day window unavailable' };
    return results.every((r) => !r.data) ? carry('supply', current) : current;
  }
  async function fees() {
    const r = await source('growthepie', 'https://www.growthepie.xyz', async () => {
      const fund = requireArray(await json('https://api.growthepie.xyz/v1/fundamentals.json'), 'fee fundamentals');
      const want = new Set(['fees_paid_usd', 'costs_blobs_usd', 'costs_l1_usd', 'costs_total_usd', 'rent_paid_usd', 'ethereum_blobs_usd', 'stables_mcap', 'tvl']);
      const idx = {}, rejected = [];
      for (const row of fund) {
        if (!want.has(row.metric_key)) continue;
        if (!observationTime(row.date, now) || nonnegative(row.value) === null) { rejected.push(row); continue; }
        ((idx[row.metric_key] ??= {})[row.origin_key] ??= new Map()).set(row.date, Number(row.value));
      }
      const excluded = (k) => ['ethereum', 'all_l2s', 'multiple', 'all', 'total'].includes(k) || k.startsWith('testnet');
      const keys = [...new Set(['costs_total_usd', 'costs_blobs_usd', 'costs_l1_usd', 'rent_paid_usd'].flatMap((m) => Object.keys(idx[m] || {})))].filter((k) => !excluded(k)).sort();
      const series = (metric, origin) => [...(idx[metric]?.[origin]?.entries() || [])].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
      const value = (metric, origin, date) => idx[metric]?.[origin]?.get(date) ?? null;
      const ethFees = series('fees_paid_usd', 'ethereum');
      if (!ethFees.length) throw new Error('No nonfuture Ethereum fee observations');
      const latestDate = ethFees.at(-1).date;
      const observedBlobKeys = keys.filter((k) => idx.costs_blobs_usd?.[k]);
      const previousCohort = previous.auto?.fees?.health?.cohortId;
      const expectedBlobKeys = previousCohort?.startsWith('execution+blob:') ? previousCohort.slice('execution+blob:'.length).split('|').filter(Boolean) : null;
      const blobKeys = expectedBlobKeys || observedBlobKeys;
      const cohortChanged = !!expectedBlobKeys && expectedBlobKeys.join('|') !== observedBlobKeys.join('|');
      const blobSeries = ethFees.map(({ date }) => ({ date, value: sumComplete(blobKeys.map((k) => value('costs_blobs_usd', k, date))),
        expected: blobKeys.length, received: blobKeys.filter((k) => value('costs_blobs_usd', k, date) !== null).length }));
      const fullSeries = ethFees.map(({ date, value: execution }, i) => ({ date, value: sumComplete([execution, blobSeries[i].value]), executionUsd: execution, blobUsd: blobSeries[i].value }));
      const day = new Date(latestDate).getTime();
      const last30dates = Array.from({ length: 30 }, (_, i) => new Date(day - (29 - i) * DAY_MS).toISOString().slice(0, 10));
      const normalizeDate = (date) => new Date(date).toISOString().slice(0, 10);
      const ethMap = new Map(ethFees.map((r) => [normalizeDate(r.date), r.value]));
      const fullMap = new Map(fullSeries.map((r) => [normalizeDate(r.date), r.value]));
      const average = (mp) => { const values = last30dates.map((d) => mp.get(d) ?? null); return sumComplete(values) === null ? null : mean(values); };
      const executionAvg = average(ethMap);
      const annualizedReported = executionAvg === null ? null : executionAvg * 365;
      const stables = value('stables_mcap', 'ethereum', latestDate), tvl = value('tvl', 'ethereum', latestDate);
      const onchainValue = sumComplete([stables, tvl]);
      // Only the upstream Ethereum-recipient-specific rent metric is usable here.
      // costs_blobs includes Celestia/EigenDA; costs_total and costs_l1 include other recipients.
      const paid = (origin, date) => value('rent_paid_usd', origin, date);
      const expectedL2Cohort = previous.auto?.fees?.l2PaidToL1?.cohortId;
      const l2CohortChanged = !!expectedL2Cohort && expectedL2Cohort !== keys.join('|');
      const monthly = new Map();
      const dates = [...new Set(keys.flatMap((k) => series('fees_paid_usd', k).map((r) => r.date)))].sort();
      for (const date of dates) {
        const revenue = sumComplete(keys.map((k) => value('fees_paid_usd', k, date)));
        const costs = sumComplete(keys.map((k) => paid(k, date)));
        const month = date.slice(0, 7), entry = monthly.get(month) || { revenue: 0, paid: 0, complete: true, days: 0 };
        entry.days++;
        if (l2CohortChanged || revenue === null || costs === null) entry.complete = false;
        else { entry.revenue += revenue; entry.paid += costs; }
        monthly.set(month, entry);
      }
      const ratioSeries = [...monthly.entries()].map(([t, r]) => ({ t, v: r.complete ? percent(r.paid, r.revenue) : null, complete: r.complete, observedDays: r.days }));
      const rawFeeSeries = fullSeries.map((r) => ({ t: r.date, reportedL1FeesUsd: r.executionUsd, reportedDaCostsUsd: r.blobUsd, fullFeesUsd: null }));
      const complete = executionAvg !== null;
      return { data: {
        cohortChanged, cohortReviewRequired: cohortChanged, observedCohortId: `execution+blob:${observedBlobKeys.join('|')}`,
        l1FeesLatestUsd: round(ethFees.at(-1).value, 0), l1PlusBlobLatestUsd: null,
        l1Fees30dAvgUsd: round(executionAvg, 0), l1PlusBlob30dAvgUsd: null,
        blobRev30dAvgUsd: null, blobRevLatestUsd: null, annualizedFullFeesUsd: null,
        annualizedReportedL1FeesUsd: round(annualizedReported, 0), reportedL1FeesToMarketCapPctPerYr: null,
        fullFeesToMarketCapPctPerYr: null, obsoleteFeesToOnchainValuePctPerYr: percent(annualizedReported, onchainValue, 3),
        takeRatePctPerYr: null, onchainValueUsd: round(onchainValue, 0), ethStablesMcapUsd: round(stables, 0),
        feeObservationDate: latestDate, onchainValueObservationDate: onchainValue === null ? null : latestDate,
        reportedL1FeesBasis: '30 complete daily Ethereum fees_paid_usd observations annualized; descriptive reported-fees/market-cap ratio, not holder cash flow',
        fullFeesBasis: 'Unavailable: reported Ethereum fee/blob disjointness and full-network coverage are unverified; costs_blobs includes Ethereum, Celestia and EigenDA',
        feeAccountingSource: 'https://github.com/growthepie/gtp-backend/blob/76353b04563712801ac07f66ccff8b6b701f1cdb/backend/src/db_connector.py',
        obsoleteRatioBasis: 'Legacy reported Ethereum fees/(stablecoin stock + TVL); not valuation or monetary premium',
        rawFeeSeries, l1FeesSeries: downsample(ethFees.map((r) => ({ t: r.date, v: round(r.value, 0) }))),
        l1PlusBlobSeries: [],
        reportedDaCostsSeries: blobSeries.map((r) => ({ t: r.date, v: round(r.value, 0), expected: r.expected, received: r.received })),
        l2PaidToL1: { currentRatioPct: ratioSeries.at(-1)?.v ?? null, top5RatioPct: null, top5: [], series: ratioSeries.slice(-18),
          cohortId: expectedL2Cohort || keys.join('|'), observedCohortId: keys.join('|'), cohortReviewRequired: l2CohortChanged, method: 'Ethereum-recipient rent_paid_usd only / reported L2 fees. No substitution of cross-DA costs_total, costs_l1 or costs_blobs. Fixed origin cohort; missing observations withhold aggregate' },
      }, observedAt: latestDate, status: complete && !cohortChanged && !rejected.length ? 'ok' : 'partial',
      reason: cohortChanged ? 'Blob origin cohort changed; review required before new aggregate is accepted' : !complete ? 'Reported Ethereum fee 30-day window incomplete; missing fees never treated as zero' : rejected.length ? 'Invalid/future observations excluded' : null,
      cohortId: `execution+blob:${blobKeys.join('|')}`, coverage: { expectedDays: 30, completeDays: last30dates.filter((d) => ethMap.has(d)).length,
        contextualDaCompleteDays: last30dates.filter((d) => fullMap.get(d) !== null && fullMap.has(d)).length, blobOrigins: blobKeys.length, fullFeeCoverageVerified: false, rejectedRows: rejected.length } };
    }, 72);
    const current = finish('fees', r.data || {}, healths(['growthepie', r]), { cohortId: r.cohortId, coverage: r.coverage });
    return r.data ? current : carry('fees', current);
  }
  async function l2() {
    const r = await source('l2beat', 'https://l2beat.com', async () => {
      const sum = await json('https://l2beat.com/api/scaling/summary');
      const points = requireArray(sum.chart?.data, 'L2BEAT chart').filter((r) => observationTime(r[0], now));
      const last = points.at(-1);
      if (!last) throw new Error('No nonfuture L2 observation');
      const totalTvlUsd = sumComplete([nonnegative(last[1]), nonnegative(last[2]), nonnegative(last[3])]);
      if (totalTvlUsd === null) throw new Error('Missing L2 TVL component');
      return { data: { totalTvlUsd: round(totalTvlUsd, 0), asOfTs: last[0] }, observedAt: last[0] };
    }, 72);
    const current = finish('l2', r.data || {}, healths(['l2beat', r]));
    return r.data ? current : carry('l2', current);
  }
  return { market, collateral, restaking, stablecoins, chains, rwa, supply, fees, l2, sources, now };
}

// Legacy values can remain as stale context, but obsolete identity/derived claims cannot.
export function sanitizeLegacy(group, prior) {
  const result = structuredClone(prior);
  if (group === 'vol') { result.quartersUnder50 = null; result.rv365Persistence = { status: 'unknown', belowThreshold: null }; }
  if (group === 'restaking') {
    delete result.restakedEth; delete result.restakedToStakedPct;
    result.restakedEthEquivalent = null; result.underlyingEth = null; result.slashableEth = null; result.paidAvsRevenueUsd = null;
    result.method = 'Historical USD TVL context only; underlying and slashable ETH unmeasured';
  }
  if (group === 'collateral') {
    for (const key of ['ethMaxLltvPct', 'ethMaxLltvStatus', 'ethMaxLltvDeltaPp']) delete result[key];
    result.combinedEthSharePct = null; result.combinedStableSharePct = null; result.combinedTotalUsd = null; result.combinedEthShareDeltaPp = null;
    result.drift = []; result.driftWindowMonths = null; result.morphoFinance = null;
    result.method = 'Historical per-venue proxy context; no validated comparable collateral aggregate';
    result.perVenue = (result.perVenue || []).map((v) => ({ ...v, basis: 'historical pool composition proxy; not true collateral' }));
  }
  if (group === 'fees') {
    result.fullFeesToMarketCapPctPerYr = null; result.reportedL1FeesToMarketCapPctPerYr = null; result.annualizedReportedL1FeesUsd = null; result.obsoleteFeesToOnchainValuePctPerYr = null;
    result.takeRatePctPerYr = null; result.annualizedFullFeesUsd = null;
  }
  if (group === 'rwa') { result.newIssuanceUsd = null; result.stockChangePct = null; result.manualReviewRequired = false; }
  return result;
}

export function historyRow(snapshot) {
  const a = snapshot.auto;
  return { t: snapshot.generatedUtc, schemaVersion: SCHEMA_VERSION, methodologyVersion: METHODOLOGY_VERSION,
    groupHealth: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.health])),
    groupCoverage: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.health?.coverage ?? null])),
    ethUsd: a.eth?.price ?? null, ethBtc: a.ratio?.now ?? null, vol365: a.vol?.d365Pct ?? null, corr90: a.correlation?.now ?? null,
    ethCollateralSharePct: null, stakingPct: a.supply?.stakingPct ?? null, net30dEth: a.supply?.net30dEth ?? null,
    l1FeesUsd: a.fees?.l1FeesLatestUsd ?? null, reportedL1FeesToMarketCapPctPerYr: a.fees?.reportedL1FeesToMarketCapPctPerYr ?? null, fullFeesToMarketCapPctPerYr: a.fees?.fullFeesToMarketCapPctPerYr ?? null,
    obsoleteFeesToOnchainValuePctPerYr: a.fees?.obsoleteFeesToOnchainValuePctPerYr ?? null,
    morphoBorrowWeightedLltvPct: a.collateral?.morphoFinance?.borrowWeightedLltvPct ?? null,
    restakingTvlUsd: a.restaking?.totalUsd ?? null, restakedEthEquivalent: a.restaking?.restakedEthEquivalent ?? null,
    rwaEthSharePct: a.rwa?.ethSharePct ?? null, rwaEthValueUsd: a.rwa?.ethUsd ?? null, rwaTotalUsd: a.rwa?.totalUsd ?? null,
    rwaManualReviewRequired: a.rwa?.manualReviewRequired ?? false,
    stablecoinEthAlignedSharePct: a.stablecoins?.ethAlignedSharePct ?? null,
    stablecoinEthAlignedStrictSharePct: a.stablecoins?.ethAlignedSharePctStrict ?? null,
    stablecoinAlignedGapPp: a.stablecoins?.ethAlignedBroadMinusStrictPp ?? null, rwaAlignedGapPp: a.rwa?.ethAlignedBroadMinusStrictPp ?? null,
    ethChainSharePct: a.chains?.ethSharePct ?? null, solChainSharePct: a.chains?.solanaSharePct ?? null,
    ethDexVolSharePct: a.chains?.ethDexVolSharePct ?? null, solDexVolSharePct: a.chains?.solDexVolSharePct ?? null,
    netIssuancePctPerYr: num(a.supply?.net30dEth) !== null && num(a.supply?.totalSupplyEth) > 0 ? round(a.supply.net30dEth / 30 * 365 / a.supply.totalSupplyEth * 100) : null };
}
export async function buildSnapshot({ previous = {}, manual = {}, history = [], now = new Date().toISOString(), fetchImpl, retries = 2, retryDelay = 500 } = {}) {
  const f = createFetchers({ previous, now, fetchImpl, retries, retryDelay });
  const [market, collateral, stablecoins, chains, rwa, supply, fees, l2, restaking] = await Promise.all([
    f.market(), f.collateral(), f.stablecoins(), f.chains(), f.rwa(), f.supply(), f.fees(), f.l2(), f.restaking(),
  ]);
  const auto = { ...market, collateral, stablecoins, chains, rwa, supply, fees, l2, restaking };
  const priceObservation = market.eth?.health?.observedAt, feeObservation = fees.health?.observedAt;
  const feeMarketCompatible = market.eth?.health?.status === 'ok' && fees.health?.status === 'ok'
    && priceObservation && feeObservation && Math.abs(Date.parse(priceObservation) - Date.parse(feeObservation)) <= 72 * 3600000;
  fees.fullFeesToMarketCapPctPerYr = null;
  fees.reportedL1FeesToMarketCapPctPerYr = feeMarketCompatible ? percent(fees.annualizedReportedL1FeesUsd, market.eth?.mcap, 6) : null;
  fees.marketCapDenominatorUsd = feeMarketCompatible ? market.eth?.mcap ?? null : null;
  fees.marketCapObservationAt = priceObservation ?? null;
  fees.ratioCoverage = { compatibleObservations: !!feeMarketCompatible, maxSkewHours: 72,
    numeratorObservedAt: feeObservation ?? null, denominatorObservedAt: priceObservation ?? null };
  const restakingObservation = restaking.health?.observedAt;
  const conversionCompatible = restaking.health?.status === 'ok' && market.eth?.health?.status === 'ok' && restakingObservation && priceObservation
    && Math.abs(Date.parse(restakingObservation) - Date.parse(priceObservation)) <= 24 * 3600000;
  restaking.restakedEthEquivalent = conversionCompatible && num(market.eth?.price) > 0 ? round(restaking.totalUsd / market.eth.price, 0) : null;
  restaking.equivalentReason = conversionCompatible ? 'USD TVL / ETH price; not actual ETH holdings' : 'Compatible source observation times unavailable; conversion withheld';
  const snapshot = { schemaVersion: SCHEMA_VERSION, methodologyVersion: METHODOLOGY_VERSION, generatedUtc: f.now,
    meta: { schemaVersion: SCHEMA_VERSION, methodologyVersion: METHODOLOGY_VERSION, sources: Object.values(f.sources),
      note: 'Evidence and quality metadata only. Gross fees, USD TVL, and pool-composition proxies are not holder cash flow, actual ETH security, or true collateral.' }, auto, manual };
  auto.vol.rv365Persistence = rv365Persistence(history, historyRow(snapshot), f.now);
  return snapshot;
}

export function appendHistory(dataDir, row) {
  const jsonPath = path.join(dataDir, 'history.json'), logPath = path.join(dataDir, 'history.ndjson');
  const original = fs.existsSync(jsonPath) ? fs.readFileSync(jsonPath, 'utf8') : '[]';
  const existing = JSON.parse(original);
  if (!Array.isArray(existing)) throw new Error('history.json must remain an array; refusing to replace it');
  const closing = original.lastIndexOf(']');
  if (closing < 0) throw new Error('history.json closing bracket missing');
  const encoded = JSON.stringify(row);
  // Do not parse/stringify or truncate old rows. Their existing bytes remain unchanged.
  const next = original.slice(0, closing) + (existing.length ? ',' : '') + encoded + original.slice(closing);
  JSON.parse(next);
  const oldLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  fs.appendFileSync(logPath, (oldLog && !oldLog.endsWith('\n') ? '\n' : '') + encoded + '\n');
  fs.writeFileSync(jsonPath, next);
}
export async function run({ dataDir = path.join(ROOT, 'data'), fetchImpl, now, write = true, retries, retryDelay } = {}) {
  const read = (name, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } };
  const previous = read('latest.json', {}), manual = read('manual.json', {}), history = read('history.json', []);
  const snapshot = await buildSnapshot({ previous, manual, history, now, fetchImpl, retries, retryDelay });
  if (write) {
    fs.mkdirSync(dataDir, { recursive: true });
    appendHistory(dataDir, historyRow(snapshot));
    fs.writeFileSync(path.join(dataDir, 'latest.json'), JSON.stringify(snapshot, null, 2) + '\n');
  }
  return snapshot;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().then((snapshot) => {
    const ok = snapshot.meta.sources.filter((s) => s.status === 'ok').length;
    console.log(`Evidence snapshot v${SCHEMA_VERSION}: ${ok}/${snapshot.meta.sources.length} sources current; missing data remains unknown`);
    if (!ok) process.exitCode = 1;
  }).catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
}
