// Observable pathway indicators. Pure functions; every output is either a measured
// number or null. Nothing here scores a thesis or maps to a price.
import { classifyToken, isUsdStable } from './tokens.mjs';

const DAY = 86400000;
const finite = (v) => typeof v === 'number' && Number.isFinite(v) ? v : null;
const round = (v, places = 2) => finite(v) === null ? null : Number(v.toFixed(places));

// USD-stable debt split by the family of the collateral that backs it.
// Works only where each market has exactly one collateral and one loan asset
// (isolated markets), so attribution is exact inside the venue. A missing
// borrow balance withholds every aggregate instead of shrinking the denominator.
export function usdDebtByCollateral(markets) {
  const empty = { complete: false, marketCount: 0, missingBorrow: 0, totalUsdDebt: null,
    ethUsdDebt: null, btcUsdDebt: null, otherUsdDebt: null, ethSharePct: null, btcSharePct: null, otherSharePct: null,
    ethToBtcDebtRatio: null, ethDebtWeightedLltvPct: null, btcDebtWeightedLltvPct: null, lltvGapPp: null,
    ethMarketCount: null, btcMarketCount: null, otherMarketCount: null };
  if (!Array.isArray(markets)) return empty;
  const usd = markets.filter((m) => m && isUsdStable(m.loanSymbol));
  const known = usd.filter((m) => finite(m.borrowUsd) !== null && m.borrowUsd >= 0);
  const complete = usd.length > 0 && known.length === usd.length;
  if (!complete) return { ...empty, marketCount: usd.length, missingBorrow: usd.length - known.length };
  const debt = { eth: 0, btc: 0, other: 0 }, count = { eth: 0, btc: 0, other: 0 };
  const weighted = { eth: 0, btc: 0 }, lltvComplete = { eth: true, btc: true };
  for (const m of known) {
    const c = classifyToken(m.collateralSymbol), family = c === 'eth' || c === 'btc' ? c : 'other';
    debt[family] += m.borrowUsd; count[family]++;
    if (family === 'other' || m.borrowUsd === 0) continue;
    const lltv = finite(m.lltvPct);
    if (lltv === null || lltv < 0 || lltv > 100) lltvComplete[family] = false;
    else weighted[family] += lltv * m.borrowUsd;
  }
  const total = debt.eth + debt.btc + debt.other;
  const share = (v) => total > 0 ? round(v / total * 100, 2) : null;
  const lltv = (f) => debt[f] > 0 && lltvComplete[f] ? round(weighted[f] / debt[f], 3) : null;
  const ethLltv = lltv('eth'), btcLltv = lltv('btc');
  return { complete, marketCount: usd.length, missingBorrow: 0, totalUsdDebt: total,
    ethUsdDebt: debt.eth, btcUsdDebt: debt.btc, otherUsdDebt: debt.other,
    ethSharePct: share(debt.eth), btcSharePct: share(debt.btc), otherSharePct: share(debt.other),
    ethToBtcDebtRatio: debt.btc > 0 ? round(debt.eth / debt.btc, 4) : null,
    ethDebtWeightedLltvPct: ethLltv, btcDebtWeightedLltvPct: btcLltv,
    lltvGapPp: ethLltv !== null && btcLltv !== null ? round(ethLltv - btcLltv, 3) : null,
    ethMarketCount: count.eth, btcMarketCount: count.btc, otherMarketCount: count.other };
}

// Where the live value sits inside its trailing daily range. `daily` holds one
// genuine observation per UTC day, oldest first; the live value is compared
// against that history rather than inserted into it.
export function trailingRange(daily, now, nowMs, { minCoverageDays = 360, maxGapDays = 1.5 } = {}) {
  const unknown = { status: 'unknown', low: null, lowAt: null, high: null, highAt: null, positionPct: null,
    newLow: null, newHigh: null, daysSinceLow: null, daysSinceHigh: null, coverageDays: null };
  const rows = (Array.isArray(daily) ? daily : []).filter((p) => finite(p?.t) !== null && finite(p?.v) !== null && p.v > 0)
    .slice().sort((a, b) => a.t - b.t);
  const live = finite(now), at = finite(nowMs);
  if (rows.length < 2 || live === null || live <= 0 || at === null || at < rows.at(-1).t) return unknown;
  const coverageDays = (rows.at(-1).t - rows[0].t) / DAY;
  const gap = Math.max(...rows.slice(1).map((p, i) => (p.t - rows[i].t) / DAY));
  if (coverageDays < minCoverageDays || gap > maxGapDays || (at - rows.at(-1).t) / DAY > maxGapDays + 1)
    return { ...unknown, coverageDays: round(coverageDays, 1) };
  let low = rows[0], high = rows[0];
  for (const p of rows) { if (p.v <= low.v) low = p; if (p.v >= high.v) high = p; }
  const newLow = live < low.v, newHigh = live > high.v;
  const lo = newLow ? { t: at, v: live } : low, hi = newHigh ? { t: at, v: live } : high;
  return { status: 'observed', low: lo.v, lowAt: new Date(lo.t).toISOString(), high: hi.v, highAt: new Date(hi.t).toISOString(),
    positionPct: hi.v > lo.v ? round((live - lo.v) / (hi.v - lo.v) * 100, 1) : null,
    newLow, newHigh, daysSinceLow: round((at - lo.t) / DAY, 1), daysSinceHigh: round((at - hi.t) / DAY, 1),
    coverageDays: round(coverageDays, 1) };
}

// Share of a 30-day gross issuance that the same 30 days of burn offset. 100 = break-even.
export function burnOffsetPct(burn30dEth, issuance30dEth) {
  const b = finite(burn30dEth), i = finite(issuance30dEth);
  return b === null || b < 0 || i === null || i <= 0 ? null : round(b / i * 100, 3);
}

export function sharePct(part, total, places = 3) {
  const p = finite(part), t = finite(total);
  return p === null || p < 0 || t === null || t <= 0 ? null : round(p / t * 100, places);
}

// Membership change of a share denominator. Additions are a wider universe and are
// accepted. A removal is accepted only when what the member last held is known and
// immaterial. A balance on record is used first; a hand review supplies the balance
// (and the total it was measured against) only where no record exists. Anything else
// withholds the denominator until someone looks.
export function assessCohortChange({ expected, observed, lastBalances = {}, priorTotal = null, reviewedDrops = {}, materialityPct = 0.05 }) {
  if (!Array.isArray(expected) || !expected.length) return { accepted: true, added: [], dropped: [], reason: null };
  const have = new Set(observed), want = new Set(expected);
  const added = observed.filter((n) => !want.has(n));
  const dropped = expected.filter((n) => !have.has(n)).map((name) => {
    const recorded = finite(lastBalances?.[name]);
    const review = recorded === null && Object.hasOwn(reviewedDrops, name) ? reviewedDrops[name] : null;
    return { name, lastUsd: recorded !== null ? recorded : review ? finite(review.lastUsd) : null, reviewed: !!review };
  });
  if (!dropped.length) return { accepted: true, added, dropped, reason: null };
  if (dropped.some((d) => d.lastUsd === null || d.lastUsd < 0))
    return { accepted: false, added, dropped, reason: 'Removed member has no known last balance; review required' };
  const droppedUsd = dropped.reduce((s, d) => s + d.lastUsd, 0);
  // Without a recorded total, the smallest total quoted by the reviews gives the largest share.
  const reviewTotals = dropped.filter((d) => d.reviewed).map((d) => finite(reviewedDrops[d.name].priorTotalUsd)).filter((v) => v !== null && v > 0);
  const total = finite(priorTotal) ?? (reviewTotals.length ? Math.min(...reviewTotals) : null);
  const droppedPct = droppedUsd === 0 ? 0 : total !== null && total > 0 ? droppedUsd / total * 100 : null;
  if (droppedPct === null) return { accepted: false, added, dropped, reason: 'Prior denominator unknown; review required' };
  return droppedPct <= materialityPct
    ? { accepted: true, added, dropped, droppedPct: round(droppedPct, 7), reason: null }
    : { accepted: false, added, dropped, droppedPct: round(droppedPct, 7), reason: 'Removed members are material; review required' };
}

// Front matter of an EIP markdown file. Returns null unless it is the expected EIP.
const EIP_STATUSES = ['Idea', 'Draft', 'Review', 'Last Call', 'Final', 'Stagnant', 'Withdrawn', 'Living', 'Moved'];
export function parseEipFrontMatter(text, expectedNumber) {
  if (typeof text !== 'string') return null;
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!block) return null;
  const field = (key) => (new RegExp(`^${key}:[ \\t]*(.+)$`, 'm').exec(block[1]) || [])[1]?.trim() ?? null;
  const number = Number(field('eip')), status = field('status');
  if (!Number.isInteger(number) || number !== expectedNumber || !EIP_STATUSES.includes(status)) return null;
  return { eip: number, title: field('title'), status, created: field('created'), category: field('category') };
}
