// scripts/fetch.mjs
//
// Pulls every AUTO metric from keyless public APIs, computes the derived series
// (realized vol, 90d ETH/BTC correlation, collateral composition, L2→L1 take),
// merges human-curated data/manual.json, scores the CHI, then writes:
//   - data/latest.json   : full snapshot the static site imports
//   - data/history.ndjson : append-only longitudinal log (the git record)
//   - data/history.json   : parsed tail of the log, imported for score sparklines
//
// Guardrails: NEVER fabricate. Each source is isolated; on failure the previous
// snapshot's value is carried forward and stamped { stale:true }. Run: npm run fetch
//
// APIs (all verified keyless 2026-06-14):
//   CoinGecko /coins/markets, /coins/{id}/market_chart
//   DefiLlama /protocol/{slug}, /v2/chains, stablecoins.llama.fi/stablecoinchains
//   ultrasound.money /api/v2/fees/{eth-supply-parts,effective-balance-sum,supply-over-time,burn-sums,issuance-estimate}
//   growthepie /v1/{master,fundamentals}.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeCHI } from '../src/lib/chi.mjs';
import { ETH_ALIGNED_CHAINS, ETH_ALIGNED_CHAINS_STRICT } from '../src/lib/kill.mjs';
import { drawdownPctFromAth, alignmentGapPp } from '../src/lib/market.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const F_LATEST = path.join(DATA, 'latest.json');
const F_NDJSON = path.join(DATA, 'history.ndjson');
const F_HISTJSON = path.join(DATA, 'history.json');
const F_MANUAL = path.join(DATA, 'manual.json');

const NOW = new Date();
const NOW_ISO = NOW.toISOString();
const SLOTS_PER_YEAR = (365.25 * 86400) / 12; // ~2,629,800

// ---------------------------------------------------------------- http + math
async function fetchJson(url, { timeout = 25000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'eth-capital-mandate/1.0 (+github actions)', ...headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url.slice(0, 80)}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
async function withRetry(fn, tries = 3, delay = 1500) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, delay * (i + 1)));
    }
  }
  throw err;
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const stdev = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};
const logRets = (p) => {
  const r = [];
  for (let i = 1; i < p.length; i++) if (p[i] > 0 && p[i - 1] > 0) r.push(Math.log(p[i] / p[i - 1]));
  return r;
};
const annVol = (rets) => stdev(rets) * Math.sqrt(365) * 100; // % annualized
function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  const mx = mean(x), my = mean(y);
  let s = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx, b = y[i] - my;
    s += a * b; dx += a * a; dy += b * b;
  }
  return dx && dy ? s / Math.sqrt(dx * dy) : null;
}
function downsample(arr, target) {
  if (arr.length <= target) return arr;
  const step = arr.length / target;
  const out = [];
  for (let i = 0; i < target; i++) out.push(arr[Math.floor(i * step)]);
  out.push(arr[arr.length - 1]);
  return out;
}
const r2 = (x, d = 2) => (typeof x === 'number' && isFinite(x) ? +x.toFixed(d) : null);

// ---------------------------------------------------------------- prev + manual
let prev = {};
try { prev = JSON.parse(fs.readFileSync(F_LATEST, 'utf8')); } catch {}
let manual = {};
try { manual = JSON.parse(fs.readFileSync(F_MANUAL, 'utf8')); } catch (e) { console.warn('manual.json unreadable:', e.message); }

const sources = []; // {key,label,url,ok,asOf,error}
function record(key, label, url, ok, error) {
  sources.push({ key, label, url, ok, asOf: ok ? NOW_ISO : prevAsOf(key), error: error || null });
}
const prevAsOf = (key) => prev?.meta?.sources?.find((s) => s.key === key)?.asOf || null;
// carry forward a previous auto group, stamped stale
const carry = (group) => (prev?.auto?.[group] ? { ...prev.auto[group], stale: true } : { stale: true, unavailable: true });

// ---------------------------------------------------------------- token buckets
const ETH_SET = new Set(['ETH', 'WETH', 'STETH', 'WSTETH', 'WEETH', 'RETH', 'CBETH', 'ETHX', 'EZETH', 'OSETH', 'RSETH', 'TETH', 'SFRXETH', 'FRXETH', 'METH', 'CMETH', 'SWETH', 'RSWETH', 'PUFETH', 'LSETH', 'OETH', 'UNIETH', 'ANKRETH', 'MSETH', 'WBETH', 'EETH', 'APXETH', 'PXETH', 'YNETH', 'INETH', 'WOETH']);
const BTC_SET = new Set(['WBTC', 'CBBTC', 'TBTC', 'LBTC', 'EBTC', 'FBTC', 'BTCB', 'SOLVBTC', 'KBTC', 'PUMPBTC', 'UNIBTC', 'SWBTC', 'XBTC', 'BTC.B']);
const STABLE_SET = new Set(['DAI', 'GHO', 'FRAX', 'LUSD', 'SDAI', 'SUSDS', 'SUSDE', 'USDE', 'RLUSD', 'PYUSD', 'TUSD', 'CRVUSD', 'GUSD', 'FDUSD', 'USDD', 'MUSD', 'EUSDE', 'USD0', 'USDG', 'USDTB', 'SYRUPUSDT', 'XAUT', 'PAXG', 'EURC', 'EUROC', 'USDS', 'USDC', 'USDT']);
function classifyToken(symRaw) {
  const s = String(symRaw).toUpperCase();
  if (s.startsWith('PT-') || s.startsWith('YT-')) {
    if (/ETH/.test(s)) return 'eth';
    if (/BTC/.test(s)) return 'btc';
    return 'stable';
  }
  if (ETH_SET.has(s)) return 'eth';
  if (BTC_SET.has(s)) return 'btc';
  if (STABLE_SET.has(s) || s.includes('USD') || s.includes('EUR')) return 'stable';
  return 'other';
}
function bucketize(tokens) {
  const b = { eth: 0, stable: 0, btc: 0, other: 0 };
  for (const [sym, usd] of Object.entries(tokens || {})) {
    const v = Number(usd) || 0;
    if (v > 0) b[classifyToken(sym)] += v;
  }
  return b;
}
const bTotal = (b) => b.eth + b.stable + b.btc + b.other;
function bucketsAt(toks, tsSec) {
  let chosen = null;
  for (const e of toks) {
    if (e.date <= tsSec) chosen = e; else break;
  }
  return chosen ? bucketize(chosen.tokens) : null;
}

// ================================================================ FETCHERS
// Each returns a plain object or throws. Composed below with carry-forward.

async function getMarket() {
  const mkts = await withRetry(() =>
    fetchJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=ethereum,bitcoin&price_change_percentage=24h'));
  const eth = mkts.find((m) => m.id === 'ethereum');
  const btc = mkts.find((m) => m.id === 'bitcoin');
  if (!eth || !btc) throw new Error('markets: missing eth/btc');
  const ethChart = await withRetry(() =>
    fetchJson('https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=365&interval=daily'));
  const btcChart = await withRetry(() =>
    fetchJson('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily'));

  const ethPx = ethChart.prices.map((p) => p[1]);
  const ethTs = ethChart.prices.map((p) => p[0]);
  const btcPx = btcChart.prices.map((p) => p[1]);
  const n = Math.min(ethPx.length, btcPx.length);

  const ethR = logRets(ethPx);
  const btcR = logRets(btcPx);
  const d30 = annVol(ethR.slice(-30));
  const d365 = annVol(ethR);

  // quarters (~91d blocks), most-recent first; consecutive count < 50%
  const qVols = [];
  for (let end = ethR.length; end > 0; end -= 91) {
    const block = ethR.slice(Math.max(0, end - 91), end);
    if (block.length >= 30) qVols.push(annVol(block));
  }
  let quartersUnder50 = 0;
  for (const v of qVols) { if (v < 50) quartersUnder50++; else break; }

  // 90d rolling ETH/BTC correlation of daily log returns
  const W = 90;
  const m = Math.min(ethR.length, btcR.length);
  const corr = [];
  for (let i = W; i <= m; i++) {
    const c = pearson(ethR.slice(i - W, i), btcR.slice(i - W, i));
    if (c !== null) corr.push({ t: ethTs[i], v: r2(c, 4) });
  }
  const corrNow = corr.length ? corr[corr.length - 1].v : null;

  // 30d rolling realized-vol series (for sparkline)
  const volSeries = [];
  for (let i = 30; i < ethR.length; i++) volSeries.push({ t: ethTs[i + 1] || ethTs[i], v: r2(annVol(ethR.slice(i - 30, i)), 1) });

  // CHI-1-facing drawdown uses the TRUE all-time high (A4). The rolling 365d-window max is
  // kept as a separate display field, but it must NOT feed CHI-1: once the real ATH slides
  // out of the window, the windowed drawdown shrinks abruptly at a flat price and would
  // falsely relieve CHI-1's ≥50% trigger. ATH is from CoinGecko, never hardcoded.
  const roll365High = Math.max(...ethPx);
  const drawdownFrom365dHighPct = roll365High > 0 ? (1 - eth.current_price / roll365High) * 100 : null;
  const drawdownFromPeakPct = drawdownPctFromAth(eth.current_price, eth.ath);
  const ratioNow = btc.current_price > 0 ? eth.current_price / btc.current_price : null;
  const ratioSeries = [];
  for (let i = 0; i < n; i++) ratioSeries.push({ t: ethTs[i], v: r2(ethPx[i] / btcPx[i], 6) });

  return {
    eth: {
      price: r2(eth.current_price, 2),
      mcap: eth.market_cap,
      change24hPct: r2(eth.price_change_percentage_24h, 2),
      ath: eth.ath,
      athChangePct: r2(eth.ath_change_percentage, 1),
      circulating: eth.circulating_supply,
      drawdownFromPeakPct: r2(drawdownFromPeakPct, 1), // true-ATH — feeds CHI-1
      drawdownFrom365dHighPct: r2(drawdownFrom365dHighPct, 1), // rolling-window — display only
      priceSeries: downsample(ethChart.prices.map((p) => ({ t: p[0], v: r2(p[1], 2) })), 140),
    },
    btc: { price: r2(btc.current_price, 2), mcap: btc.market_cap },
    ratio: { now: r2(ratioNow, 6), series: downsample(ratioSeries, 140) },
    vol: { d30Pct: r2(d30, 1), d365Pct: r2(d365, 1), quartersUnder50, quarterVols: qVols.map((v) => r2(v, 0)), series: downsample(volSeries, 140) },
    correlation: { now: corrNow, series: downsample(corr, 140) },
  };
}

async function venueTokens(slug) {
  const p = await fetchJson(`https://api.llama.fi/protocol/${slug}`, { timeout: 45000 });
  const t = p?.chainTvls?.Ethereum?.tokensInUsd;
  if (Array.isArray(t) && t.length) return t.slice().sort((a, b) => a.date - b.date);
  return null;
}
async function firstVenue(name, slugs) {
  for (const s of slugs) {
    try {
      const toks = await venueTokens(s);
      if (toks) return { name, slug: s, toks };
    } catch { /* try next slug */ }
  }
  return null;
}

// Morpho Blue exposes isolated (collateral, loan) markets, so we can measure TRUE
// collateral and net same-asset-class loops/carries (rule B): for each market,
// net = max(0, collateralUsd − sameClassBorrowUsd). This drops sUSDe→stable carries
// to their equity slice and nets wstETH→ETH loops, with no per-account data needed.
async function morphoNetCollateral() {
  const gql = async (query) => {
    const res = await fetch('https://blue-api.morpho.org/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'eth-capital-mandate/1.0 (+github actions)' },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`Morpho HTTP ${res.status}`);
    const j = await res.json();
    if (j.errors) throw new Error('Morpho GQL ' + JSON.stringify(j.errors).slice(0, 120));
    return j.data;
  };
  let skip = 0, all = [];
  for (;;) {
    const d = await gql(`{ markets(first: 200, skip: ${skip}, where: { chainId_in: [1] }, orderBy: SupplyAssetsUsd, orderDirection: Desc) { items { listed lltv loanAsset { symbol } collateralAsset { symbol } state { collateralAssetsUsd borrowAssetsUsd } } } }`);
    const items = d?.markets?.items || [];
    all = all.concat(items);
    if (items.length < 200) break;
    skip += 200;
  }
  const b = { eth: 0, stable: 0, btc: 0, other: 0 };
  let ethMaxLltv = 0; // ETH's top on-chain LTV tier (= 1 − haircut), liquidity-gated
  for (const m of all) {
    if (!m.listed || !m.collateralAsset || !(m.state?.collateralAssetsUsd > 0)) continue;
    const cc = classifyToken(m.collateralAsset.symbol);
    const lc = classifyToken(m.loanAsset?.symbol);
    const coll = m.state.collateralAssetsUsd || 0;
    const borrow = m.state.borrowAssetsUsd || 0;
    b[cc] += Math.max(0, coll - (cc === lc ? borrow : 0)); // rule B: net same-class
    // ETH's haircut tier when backing UNCORRELATED debt — exclude ETH↔ETH loops, which
    // carry near-100% LTV and would overstate the collateral-grade haircut.
    if (cc === 'eth' && lc !== 'eth' && coll >= 1e6) {
      const lltv = Number(m.lltv) / 1e18;
      if (isFinite(lltv) && lltv > ethMaxLltv) ethMaxLltv = lltv;
    }
  }
  return { buckets: b, ethMaxLltvPct: ethMaxLltv > 0 ? r2(ethMaxLltv * 100, 1) : null };
}

// TRUE net-collateral composition across Aave v3 + Morpho Blue + Sky. This replaces a
// supply-side TVL share that over-counted (a) pure lenders, (b) Sky's USDC PSM /
// savings (peg reserves, NOT collateral), and (c) wstETH→ETH and sUSDe-style loops.
// Aave: DefiLlama 'Ethereum' tokensInUsd is already NET (supply − borrow) per token,
// so summing by class nets same-class loops (e.g. the ~$2.9B WETH borrowed against LST
// collateral) automatically. Sky: vault collateral only (stable bucket = PSM/savings,
// dropped). Morpho: per-market net (rule B). See README "CHI-1".
async function getCollateral() {
  const aave = await firstVenue('Aave', ['aave-v3']);
  const sky = await firstVenue('Sky', ['makerdao', 'sky']);
  if (!aave && !sky) throw new Error('collateral: no venue token data');

  let morpho = null, morphoEthMaxLltvPct = null; // best-effort: degrade to Aave+Sky if Morpho's API is unreachable
  try { const mr = await withRetry(() => morphoNetCollateral(), 2, 1500); morpho = mr.buckets; morphoEthMaxLltvPct = mr.ethMaxLltvPct; }
  catch (e) { console.warn(`! morpho collateral failed: ${e.message}`); }

  // A1: field-level health for the CHI-5 haircut leg, DISTINCT from the coarse per-source
  // record(). 'ok' = measured this run; 'stale' = sub-fetch unavailable but a prior good
  // value is carried forward; 'failed' = unavailable with no prior value. This lets chi5
  // say "feed broken" instead of the misleading "accruing" when the Morpho leg is dead.
  let ethMaxLltvPct, ethMaxLltvStatus;
  if (morpho && typeof morphoEthMaxLltvPct === 'number') {
    ethMaxLltvPct = morphoEthMaxLltvPct;
    ethMaxLltvStatus = 'ok';
  } else {
    const carried = typeof prev?.auto?.collateral?.ethMaxLltvPct === 'number' ? prev.auto.collateral.ethMaxLltvPct : null;
    ethMaxLltvPct = carried;
    ethMaxLltvStatus = carried !== null ? 'stale' : 'failed';
    console.warn(`! ETH max-LTV unavailable → status=${ethMaxLltvStatus}${carried !== null ? ` (carried ${carried}%)` : ''}`);
  }

  const skyColl = (b) => ({ ...b, stable: 0 }); // Sky: drop PSM/savings, keep vault collateral

  // current snapshot
  const combined = { eth: 0, stable: 0, btc: 0, other: 0 };
  const perVenue = [];
  const pushVenue = (name, slug, basis, b) => {
    const tot = bTotal(b) || 1;
    for (const k of Object.keys(combined)) combined[k] += b[k];
    perVenue.push({ name, slug, basis, totalUsd: Math.round(bTotal(b)), ethSharePct: r2((b.eth / tot) * 100, 1) });
  };
  if (aave) pushVenue('Aave', aave.slug, 'DL net', bucketize(aave.toks[aave.toks.length - 1].tokens));
  if (morpho) pushVenue('Morpho', 'morpho-blue', 'API net (rule B)', morpho);
  if (sky) pushVenue('Sky', sky.slug, 'vault collateral (PSM excluded)', skyColl(bucketize(sky.toks[sky.toks.length - 1].tokens)));

  const ctot = bTotal(combined) || 1;
  const combinedEthSharePct = r2((combined.eth / ctot) * 100, 1);
  const combinedStableSharePct = r2((combined.stable / ctot) * 100, 1);

  // 18-month drift. Aave (net) + Sky (PSM-excluded) have DL monthly history; Morpho has
  // no per-market history, so it's held flat at its current net value — this anchors the
  // drift's level to the headline without inventing a Morpho trend.
  const morphoConst = morpho || { eth: 0, stable: 0, btc: 0, other: 0 };
  const drift = [];
  for (let k = 17; k >= 0; k--) {
    const d = new Date(NOW.getFullYear(), NOW.getMonth() - k + 1, 0); // month-end
    const tsSec = Math.floor(d.getTime() / 1000);
    const agg = { ...morphoConst };
    let any = false;
    if (aave) { const b = bucketsAt(aave.toks, tsSec); if (b) { any = true; for (const key of Object.keys(agg)) agg[key] += b[key]; } }
    if (sky) { const b = bucketsAt(sky.toks, tsSec); if (b) { any = true; const s = skyColl(b); for (const key of Object.keys(agg)) agg[key] += s[key]; } }
    if (!any) continue;
    const tot = bTotal(agg) || 1;
    drift.push({ t: d.getTime(), ethPct: r2((agg.eth / tot) * 100, 1), stablePct: r2((agg.stable / tot) * 100, 1), btcPct: r2((agg.btc / tot) * 100, 1) });
  }
  const combinedEthShareDeltaPp = drift.length >= 2 ? r2(drift[drift.length - 1].ethPct - drift[0].ethPct, 1) : null;

  return {
    combinedEthSharePct,
    combinedStableSharePct,
    combinedEthShareDeltaPp,
    driftWindowMonths: drift.length,
    combinedTotalUsd: Math.round(ctot),
    ethMaxLltvPct, // CHI-5: ETH's top on-chain LTV tier (= 1 − haircut), Morpho-measured
    ethMaxLltvStatus, // A1: 'ok' | 'stale' | 'failed' — field-level health of the haircut leg
    venuesUsed: perVenue.map((v) => v.name),
    morphoOk: !!morpho,
    method: 'NET collateral (rule B): Aave DL-net + Morpho per-market net + Sky vault-only (USDC PSM/savings excluded). Morpho held flat across the 18m drift (no per-market history).',
    perVenue,
    drift,
  };
}

// CHI-3 source: ETH used as a slashable security bond, proxied by ETH restaked across
// the major restaking layers. DefiLlama /tvl/{slug} returns USD; the assembly converts
// it to an ETH-equivalent (price-stripped) + a restaked/staked ratio. Best-effort per
// protocol so one dead restaker doesn't sink the metric.
async function getRestaking() {
  const slugs = ['eigenlayer', 'symbiotic', 'karak'];
  const byProtocol = {};
  let totalUsd = 0;
  for (const s of slugs) {
    try {
      const usd = Number(await fetchJson(`https://api.llama.fi/tvl/${s}`));
      if (isFinite(usd) && usd > 0) { byProtocol[s] = Math.round(usd); totalUsd += usd; }
    } catch (e) { console.warn(`! restaking ${s}: ${e.message}`); }
  }
  if (totalUsd <= 0) throw new Error('restaking: no TVL from any source');
  return { totalUsd: Math.round(totalUsd), byProtocol };
}

async function getStablecoins() {
  const arr = await fetchJson('https://stablecoins.llama.fi/stablecoinchains', { timeout: 30000 });
  const rows = arr
    .map((c) => ({ name: c.name, usd: Number(c?.totalCirculatingUSD?.peggedUSD) || 0 }))
    .filter((r) => r.usd > 0);
  const total = rows.reduce((a, r) => a + r.usd, 0);
  const eth = rows.find((r) => r.name === 'Ethereum');
  // KC-2: Ethereum-aligned = mainnet + ETH-settled rollups (the payment-layer unit the kill
  // criterion actually names), aggregated over the FULL chain list, not just the top-8 shown.
  // A6: compute BROAD (current list) and STRICT (ETH-settled + ETH-DA only) aggregates so the
  // headline's sensitivity to the alignment definition is visible. ethAlignedSharePct stays
  // the BROAD value — what KC-2 scores — so scoring is UNCHANGED (the strict switch is B2).
  const alignedSet = new Set(ETH_ALIGNED_CHAINS);
  const strictSet = new Set(ETH_ALIGNED_CHAINS_STRICT);
  const ethAlignedUsd = rows.filter((r) => alignedSet.has(r.name)).reduce((a, r) => a + r.usd, 0);
  const ethStrictUsd = rows.filter((r) => strictSet.has(r.name)).reduce((a, r) => a + r.usd, 0);
  const broadPct = r2((ethAlignedUsd / total) * 100, 1);
  const strictPct = r2((ethStrictUsd / total) * 100, 1);
  const top = rows.sort((a, b) => b.usd - a.usd).slice(0, 8).map((r) => ({ name: r.name, usd: Math.round(r.usd), sharePct: r2((r.usd / total) * 100, 1) }));
  return {
    totalUsd: Math.round(total),
    ethUsd: Math.round(eth?.usd || 0),
    ethSharePct: r2(((eth?.usd || 0) / total) * 100, 1),
    ethAlignedUsd: Math.round(ethAlignedUsd),
    ethAlignedSharePct: broadPct, // = broad; KC-2 scores this (unchanged)
    ethAlignedSharePctBroad: broadPct,
    ethAlignedSharePctStrict: strictPct,
    ethAlignedBroadMinusStrictPp: alignmentGapPp(broadPct, strictPct),
    byChain: top,
  };
}

// A5: DEX-volume share by chain (DefiLlama /overview/dexs, keyless). Solana's strength
// shows in THROUGHPUT/volume before it shows in locked TVL, so volume share is the leading
// "losing the market" signal that the stock (TVL) metric reads years late. Best-effort and
// isolated: a dead dexs endpoint degrades to null, it must not sink the chain-TVL read.
async function getDexVolumeShares() {
  const overview = (slug) =>
    fetchJson(`https://api.llama.fi/overview/dexs${slug ? '/' + slug : ''}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`, { timeout: 30000 });
  const all = await overview('');
  const total30d = Number(all?.total30d);
  if (!isFinite(total30d) || total30d <= 0) throw new Error('dexs: no all-chain 30d total');
  const chainVol = async (slug) => {
    try { const c = await overview(slug); const v = Number(c?.total30d); return isFinite(v) && v > 0 ? v : null; }
    catch (e) { console.warn(`! dex vol ${slug}: ${e.message}`); return null; }
  };
  const eth30d = await chainVol('ethereum');
  const sol30d = await chainVol('solana');
  return {
    dexVolTotal30dUsd: Math.round(total30d),
    ethDexVol30dUsd: eth30d !== null ? Math.round(eth30d) : null,
    solDexVol30dUsd: sol30d !== null ? Math.round(sol30d) : null,
    ethDexVolSharePct: eth30d !== null ? r2((eth30d / total30d) * 100, 1) : null,
    solDexVolSharePct: sol30d !== null ? r2((sol30d / total30d) * 100, 1) : null,
    dexVolWindow: '30d',
  };
}

async function getChains() {
  const arr = await fetchJson('https://api.llama.fi/v2/chains', { timeout: 30000 });
  const pick = (n) => arr.find((c) => c.name === n)?.tvl || null;
  const eth = pick('Ethereum');
  const sol = pick('Solana');
  const total = arr.reduce((a, c) => a + (c.tvl || 0), 0);
  // DEX-volume leg (best-effort): null shares on failure, never throws out of getChains.
  let dex = { ethDexVolSharePct: null, solDexVolSharePct: null, dexVolWindow: '30d' };
  try { dex = { ...dex, ...(await getDexVolumeShares()) }; }
  catch (e) { console.warn(`! dex volume failed: ${e.message}`); }
  return {
    ethTvl: eth ? Math.round(eth) : null,
    solanaTvl: sol ? Math.round(sol) : null,
    totalTvl: Math.round(total),
    ethSharePct: eth ? r2((eth / total) * 100, 1) : null,
    solanaSharePct: sol ? r2((sol / total) * 100, 1) : null,
    ...dex,
  };
}

async function getRwa() {
  const protos = await fetchJson('https://api.llama.fi/protocols', { timeout: 45000 });
  const byChain = {};
  let total = 0;
  for (const p of protos) {
    if ((p.category || '') !== 'RWA') continue;
    for (const [chain, tvl] of Object.entries(p.chainTvls || {})) {
      if (typeof tvl !== 'number' || tvl <= 0 || chain.includes('-') || ['borrowed', 'staking', 'pool2', 'treasury'].includes(chain)) continue;
      byChain[chain] = (byChain[chain] || 0) + tvl;
      total += tvl;
    }
  }
  const top = Object.entries(byChain).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, usd]) => ({ name, usd: Math.round(usd), sharePct: r2((usd / total) * 100, 1) }));
  // A6: broad/strict Ethereum-aligned RWA aggregates (display + divergence). KC-3 still
  // scores the mainnet-only ethSharePct below — scoring set unchanged (strict switch = B2).
  const alignedSet = new Set(ETH_ALIGNED_CHAINS);
  const strictSet = new Set(ETH_ALIGNED_CHAINS_STRICT);
  const sumWhere = (set) => Object.entries(byChain).filter(([n]) => set.has(n)).reduce((a, [, v]) => a + v, 0);
  const broadPct = total > 0 ? r2((sumWhere(alignedSet) / total) * 100, 1) : null;
  const strictPct = total > 0 ? r2((sumWhere(strictSet) / total) * 100, 1) : null;
  return {
    totalUsd: Math.round(total),
    ethUsd: byChain.Ethereum ? Math.round(byChain.Ethereum) : null, // A7: absolute mainnet RWA value (for new-issuance flow)
    ethSharePct: byChain.Ethereum ? r2((byChain.Ethereum / total) * 100, 1) : null, // mainnet — KC-3 scores this
    ethAlignedSharePctBroad: broadPct,
    ethAlignedSharePctStrict: strictPct,
    ethAlignedBroadMinusStrictPp: alignmentGapPp(broadPct, strictPct),
    byChain: top,
  };
}

async function getSupply() {
  const parts = await fetchJson('https://ultrasound.money/api/v2/fees/eth-supply-parts');
  const exec = Number(parts.executionBalancesSum) / 1e18;
  const beacon = Number(parts.beaconBalancesSum) / 1e9;
  const deposits = Number(parts.beaconDepositsSum) / 1e9;
  const totalSupply = exec + beacon - deposits; // ultrasound's supply formula
  const ebs = await fetchJson('https://ultrasound.money/api/v2/fees/effective-balance-sum');
  const stakedEffective = Number(ebs.sum) / 1e9;
  const stakedActual = beacon; // beacon balances ~ actual staked
  const stakingPct = totalSupply > 0 ? (stakedActual / totalSupply) * 100 : null;

  // net issuance/burn: supply-over-time windows are arrays of {supply,timestamp};
  // burn-sums windows are {sum:{eth,usd}}.
  let sot = {}, burn = {}, iss = {};
  try { sot = await fetchJson('https://ultrasound.money/api/v2/fees/supply-over-time'); } catch {}
  try { burn = await fetchJson('https://ultrasound.money/api/v2/fees/burn-sums'); } catch {}
  try { iss = await fetchJson('https://ultrasound.money/api/v2/fees/issuance-estimate'); } catch {}

  const deltaOf = (arr) => (Array.isArray(arr) && arr.length >= 2 ? arr[arr.length - 1].supply - arr[0].supply : null);
  const net30dEth = deltaOf(sot.d30);
  const net7dEth = deltaOf(sot.d7);
  const sinceMergeEth = deltaOf(sot.since_merge);
  const burn30dEth = Number(burn?.d30?.sum?.eth);
  const burnSinceMergeEth = Number(burn?.since_merge?.sum?.eth);
  const issGwei = Number(iss.issuance_per_slot_gwei);
  const issuanceGrossPerYrEth = isFinite(issGwei) ? (issGwei / 1e9) * SLOTS_PER_YEAR : null;
  const issuance30dEth = net30dEth !== null && isFinite(burn30dEth) ? net30dEth + burn30dEth : null;
  const supplySeries = Array.isArray(sot.since_merge)
    ? downsample(sot.since_merge.map((p) => ({ t: new Date(p.timestamp).getTime(), v: r2(p.supply, 0) })), 160)
    : [];

  return {
    totalSupplyEth: r2(totalSupply, 0),
    stakedEth: r2(stakedActual, 0),
    stakedEffectiveEth: r2(stakedEffective, 0),
    stakingPct: r2(stakingPct, 1),
    net30dEth: r2(net30dEth, 0),
    net7dEth: r2(net7dEth, 0),
    sinceMergeEth: r2(sinceMergeEth, 0),
    burn30dEth: isFinite(burn30dEth) ? r2(burn30dEth, 0) : null,
    burnSinceMergeEth: isFinite(burnSinceMergeEth) ? r2(burnSinceMergeEth, 0) : null,
    issuance30dEth: r2(issuance30dEth, 0),
    issuanceGrossPerYrEth: r2(issuanceGrossPerYrEth, 0),
    deflationary: net30dEth !== null ? net30dEth < 0 : null,
    supplySeries,
  };
}

async function getFees() {
  const fund = await fetchJson('https://api.growthepie.xyz/v1/fundamentals.json', { timeout: 45000 });
  const want = new Set(['fees_paid_usd', 'costs_blobs_usd', 'costs_l1_usd', 'costs_total_usd', 'stables_mcap', 'tvl']);
  const idx = {}; // metric -> origin -> Map(date->value)
  for (const r of fund) {
    if (!want.has(r.metric_key)) continue;
    (idx[r.metric_key] ??= {});
    (idx[r.metric_key][r.origin_key] ??= new Map()).set(r.date, +r.value);
  }
  // L2 universe = origins that pay L1 (have cost metrics), excluding ethereum + aggregates.
  const EXCLUDE = new Set(['ethereum', 'all_l2s', 'multiple', 'all', 'total']);
  const isExcluded = (k) => EXCLUDE.has(k) || k.startsWith('testnet');
  const l2set = new Set();
  for (const metric of ['costs_total_usd', 'costs_blobs_usd', 'costs_l1_usd'])
    for (const origin of Object.keys(idx[metric] || {})) if (!isExcluded(origin)) l2set.add(origin);
  const isL2 = (k) => l2set.has(k);
  const l2keys = [...l2set];

  const seriesOf = (metric, origin) => {
    const mp = idx[metric]?.[origin];
    return mp ? [...mp.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
  };
  const lastVal = (metric, origin) => {
    const s = seriesOf(metric, origin);
    return s.length ? s[s.length - 1].value : null;
  };

  // L1 execution fees (the Dencun-damage line)
  const ethFees = seriesOf('fees_paid_usd', 'ethereum');
  // blob revenue paid TO L1 = sum over L2s of costs_blobs_usd, by date
  const blobByDate = new Map();
  for (const origin of Object.keys(idx.costs_blobs_usd || {})) {
    if (!isL2(origin)) continue;
    for (const { date, value } of seriesOf('costs_blobs_usd', origin)) blobByDate.set(date, (blobByDate.get(date) || 0) + (value || 0));
  }
  const ethFeeMap = new Map(ethFees.map((d) => [d.date, d.value]));
  const allDates = [...new Set([...ethFeeMap.keys(), ...blobByDate.keys()])].sort();
  const combinedSeries = allDates.map((date) => ({ date, value: (ethFeeMap.get(date) || 0) + (blobByDate.get(date) || 0) }));
  const last30 = combinedSeries.slice(-30);
  const annualRev = (last30.length ? mean(last30.map((d) => d.value)) : 0) * 365;
  const ethStables = lastVal('stables_mcap', 'ethereum');
  const ethTvl = lastVal('tvl', 'ethereum');
  const onchainValue = (ethStables || 0) + (ethTvl || 0);
  const takeRatePct = onchainValue > 0 ? (annualRev / onchainValue) * 100 : null;
  const ethLast30 = ethFees.slice(-30);
  const l1Fees30dAvgUsd = ethLast30.length ? Math.round(mean(ethLast30.map((d) => d.value))) : null;
  const l1PlusBlob30dAvgUsd = last30.length ? Math.round(mean(last30.map((d) => d.value))) : null;
  const blobRev30dAvgUsd = l1PlusBlob30dAvgUsd != null && l1Fees30dAvgUsd != null ? l1PlusBlob30dAvgUsd - l1Fees30dAvgUsd : null;

  // L2 → L1: monthly Σpaid / Σrevenue across L2s; top-5 share over last 90d
  const monthRev = new Map(), monthPaid = new Map();
  const paidOf = (origin, date) => {
    const ct = idx.costs_total_usd?.[origin]?.get(date);
    if (ct != null) return ct;
    const l1 = idx.costs_l1_usd?.[origin]?.get(date) || 0;
    const bl = idx.costs_blobs_usd?.[origin]?.get(date) || 0;
    return l1 + bl;
  };
  const ymOf = (d) => d.slice(0, 7);
  for (const origin of l2keys) {
    for (const { date, value } of seriesOf('fees_paid_usd', origin)) {
      monthRev.set(ymOf(date), (monthRev.get(ymOf(date)) || 0) + (value || 0));
      monthPaid.set(ymOf(date), (monthPaid.get(ymOf(date)) || 0) + paidOf(origin, date));
    }
  }
  const months = [...monthRev.keys()].sort();
  const ratioSeries = months.map((ym) => ({ t: ym, v: r2((monthPaid.get(ym) / (monthRev.get(ym) || 1)) * 100, 2) }));
  const currentRatioPct = ratioSeries.length ? ratioSeries[ratioSeries.length - 1].v : null;

  // top-5 L2 paid-to-L1 share of total L2 revenue, last ~90 days
  const recent = new Set(allDates.slice(-90));
  const perL2 = {};
  let totalL2Rev = 0;
  for (const origin of l2keys) {
    let rev = 0, paid = 0;
    for (const { date, value } of seriesOf('fees_paid_usd', origin)) if (recent.has(date)) rev += value || 0;
    for (const date of recent) paid += paidOf(origin, date) || 0;
    if (rev > 0 || paid > 0) { perL2[origin] = { rev, paid }; totalL2Rev += rev; }
  }
  const top5 = Object.entries(perL2).sort((a, b) => b[1].paid - a[1].paid).slice(0, 5);
  const top5Paid = top5.reduce((a, [, v]) => a + v.paid, 0);
  const top5RatioPct = totalL2Rev > 0 ? r2((top5Paid / totalL2Rev) * 100, 1) : null;

  return {
    l1FeesLatestUsd: ethFees.length ? Math.round(ethFees[ethFees.length - 1].value) : null,
    l1PlusBlobLatestUsd: combinedSeries.length ? Math.round(combinedSeries[combinedSeries.length - 1].value) : null,
    l1Fees30dAvgUsd,
    l1PlusBlob30dAvgUsd,
    blobRev30dAvgUsd,
    l1FeesSeries: downsample(ethFees.map((d) => ({ t: d.date, v: Math.round(d.value) })), 160),
    l1PlusBlobSeries: downsample(combinedSeries.map((d) => ({ t: d.date, v: Math.round(d.value) })), 160),
    blobRevLatestUsd: blobByDate.size ? Math.round([...blobByDate.entries()].sort()[blobByDate.size - 1][1]) : null,
    takeRatePctPerYr: r2(takeRatePct, 3),
    onchainValueUsd: Math.round(onchainValue),
    ethStablesMcapUsd: ethStables ? Math.round(ethStables) : null,
    l2PaidToL1: {
      currentRatioPct,
      top5RatioPct,
      breakThresholdPct: 20,
      top5: top5.map(([k]) => k),
      series: ratioSeries.slice(-18),
    },
  };
}

async function getL2() {
  const sum = await fetchJson('https://l2beat.com/api/scaling/summary', { timeout: 30000 });
  // shape: { chart:{ types:[timestamp,native,canonical,external,ethPrice], data:[...] } }
  const data = sum?.chart?.data;
  if (!Array.isArray(data) || !data.length) throw new Error('l2beat: no chart data');
  const last = data[data.length - 1];
  // native + canonical + external — already USD-denominated
  const totalTvlUsd = (last[1] || 0) + (last[2] || 0) + (last[3] || 0);
  return { totalTvlUsd: Math.round(totalTvlUsd), asOfTs: last[0] || null };
}

// ================================================================ COMPOSE
async function run() {
  const settle = async (key, label, url, fn, group) => {
    try {
      const v = await fn();
      record(key, label, url, true);
      return { ...v, asOf: NOW_ISO, stale: false };
    } catch (e) {
      console.warn(`! ${key} failed: ${e.message}`);
      record(key, label, url, false, e.message);
      return carry(group);
    }
  };

  const [market, collateral, stablecoins, chains, rwa, supply, fees, l2, restaking] = await Promise.all([
    settle('coingecko', 'CoinGecko', 'https://www.coingecko.com/en/coins/ethereum', getMarket, '_market'),
    settle('defillama_collateral', 'DefiLlama + Morpho API (Aave/Morpho/Sky)', 'https://defillama.com/protocol/aave-v3', getCollateral, 'collateral'),
    settle('defillama_stables', 'DefiLlama Stablecoins', 'https://defillama.com/stablecoins', getStablecoins, 'stablecoins'),
    settle('defillama_chains', 'DefiLlama Chains', 'https://defillama.com/chains', getChains, 'chains'),
    settle('defillama_rwa', 'DefiLlama RWA', 'https://defillama.com/protocols/RWA', getRwa, 'rwa'),
    settle('ultrasound', 'ultrasound.money', 'https://ultrasound.money', getSupply, 'supply'),
    settle('growthepie', 'growthepie.xyz', 'https://www.growthepie.xyz', getFees, 'fees'),
    settle('l2beat', 'L2BEAT', 'https://l2beat.com', getL2, 'l2'),
    settle('defillama_restaking', 'DefiLlama Restaking', 'https://defillama.com/protocols/Restaking', getRestaking, 'restaking'),
  ]);

  // CHI-3: ETH-denominated restaked + restaked/staked ratio (strips the price effect —
  // restaking collateral is predominantly ETH/LSTs, so USD ÷ ETH price ≈ ETH bonded).
  const _ethPx = (market.eth || {}).price;
  const _stakedEth = (supply || {}).stakedEth;
  if (restaking && restaking.totalUsd > 0 && _ethPx > 0) {
    restaking.restakedEth = Math.round(restaking.totalUsd / _ethPx);
    restaking.restakedToStakedPct = _stakedEth > 0 ? r2((restaking.restakedEth / _stakedEth) * 100, 1) : null;
  }

  // CHI-5 haircut leg: trend of ETH's on-chain max LTV (compressing haircut = rising LTV).
  // Computed here (needs the longitudinal log) against the oldest logged reading; chi.mjs
  // stays pure and just reads the precomputed delta. Null until ≥1 prior reading exists.
  if (collateral && collateral.ethMaxLltvStatus === 'ok' && typeof collateral.ethMaxLltvPct === 'number') {
    let histRows = [];
    try {
      histRows = fs.readFileSync(F_NDJSON, 'utf8').trim().split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch {}
    const past = histRows.map((r) => r.ethMaxLltvPct).filter((v) => typeof v === 'number');
    if (past.length) collateral.ethMaxLltvDeltaPp = r2(collateral.ethMaxLltvPct - past[0], 1);
  }

  const auto = {
    eth: market.eth || carry('_market').eth,
    btc: market.btc,
    ratio: market.ratio,
    vol: market.vol,
    correlation: market.correlation,
    _market: { asOf: market.asOf, stale: !!market.stale },
    collateral,
    stablecoins,
    chains,
    rwa,
    supply,
    fees,
    l2,
    restaking,
  };

  const snapshot = { auto, manual };
  const chi = computeCHI(snapshot);

  const latest = {
    generatedUtc: NOW_ISO,
    meta: {
      sources,
      note: 'Probabilities are a STATED ANALYST PRIOR, not a model output. Not investment advice.',
    },
    chi,
    auto,
    manual,
  };

  fs.writeFileSync(F_LATEST, JSON.stringify(latest, null, 2));

  // append longitudinal row
  const row = {
    t: NOW_ISO,
    chiTotal: chi.total,
    litCount: chi.litCount,
    branchPct: chi.probabilities.branchPct,
    p10k: chi.probabilities.p10k,
    p20k: chi.probabilities.p20k,
    status: chi.probabilities.status,
    ethUsd: auto.eth?.price ?? null,
    ethBtc: auto.ratio?.now ?? null,
    ethCollateralSharePct: auto.collateral?.combinedEthSharePct ?? null,
    vol365: auto.vol?.d365Pct ?? null,
    corr90: auto.correlation?.now ?? null,
    stakingPct: auto.supply?.stakingPct ?? null,
    net30dEth: auto.supply?.net30dEth ?? null,
    l1FeesUsd: auto.fees?.l1FeesLatestUsd ?? null,
    ethMaxLltvPct: auto.collateral?.ethMaxLltvPct ?? null,
    // kill-criteria series (KC-2/3/5/6) — logged so the flow/persistence legs accrue
    rwaEthSharePct: auto.rwa?.ethSharePct ?? null,
    rwaEthValueUsd: auto.rwa?.ethUsd ?? null, // A7: absolute ETH RWA value — new-issuance flow accrues from these
    rwaTotalUsd: auto.rwa?.totalUsd ?? null,
    stablecoinEthAlignedSharePct: auto.stablecoins?.ethAlignedSharePct ?? null,
    stablecoinEthAlignedStrictSharePct: auto.stablecoins?.ethAlignedSharePctStrict ?? null,
    stablecoinAlignedGapPp: auto.stablecoins?.ethAlignedBroadMinusStrictPp ?? null,
    rwaAlignedGapPp: auto.rwa?.ethAlignedBroadMinusStrictPp ?? null,
    ethChainSharePct: auto.chains?.ethSharePct ?? null,
    solChainSharePct: auto.chains?.solanaSharePct ?? null,
    ethDexVolSharePct: auto.chains?.ethDexVolSharePct ?? null,
    solDexVolSharePct: auto.chains?.solDexVolSharePct ?? null,
    netIssuancePctPerYr:
      typeof auto.supply?.net30dEth === 'number' && auto.supply?.totalSupplyEth > 0
        ? r2((auto.supply.net30dEth / 30) * 365 / auto.supply.totalSupplyEth * 100, 2)
        : null,
    scores: Object.fromEntries(chi.components.map((c) => [c.key, c.score])),
  };
  fs.appendFileSync(F_NDJSON, JSON.stringify(row) + '\n');

  // rebuild history.json (tail) from ndjson for the UI score sparklines
  const lines = fs.readFileSync(F_NDJSON, 'utf8').trim().split('\n').filter(Boolean);
  const hist = lines.slice(-1000).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  fs.writeFileSync(F_HISTJSON, JSON.stringify(hist, null, 0));

  const ok = sources.filter((s) => s.ok).length;
  console.log(`\n✓ wrote latest.json — CHI ${chi.total}/${chi.components.length} (${chi.litCount} lit) → branch ${chi.probabilities.branchPct}% · ${chi.probabilities.status}`);
  console.log(`  ETH $${auto.eth?.price} · ETH/BTC ${auto.ratio?.now} · vol365 ${auto.vol?.d365Pct}% · corr90 ${auto.correlation?.now} · ETH-collateral ${auto.collateral?.combinedEthSharePct}% · staked ${auto.supply?.stakingPct}%`);
  const _lltvDelta = auto.collateral?.ethMaxLltvDeltaPp;
  console.log(`  restaked ${auto.restaking?.restakedEth?.toLocaleString?.()} ETH · ETH max-LTV ${auto.collateral?.ethMaxLltvPct}%${_lltvDelta != null ? ` (Δ ${_lltvDelta}pp)` : ' (Δ n/a)'}`);
  console.log(`  sources ok: ${ok}/${sources.length}${ok < sources.length ? ' — ' + sources.filter((s) => !s.ok).map((s) => s.key).join(',') + ' carried forward' : ''}`);
  if (ok === 0) process.exit(1);
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
