// Convention Hardening Index (CHI) — shared scoring engine.
//
// Imported by BOTH scripts/fetch.mjs (Node) and the React UI (Vite) so that the
// score and probability mapping are computed from a single source of truth. Pure
// functions only — no Node- or browser-specific APIs.
//
// Thesis under test: ETH's only durable value channel is becoming the *capital
// stock* of open on-chain finance (native, non-freezable, slashable, yield-bearing
// collateral) — NOT transaction fees. CHI scores how hard the "market convention"
// factory is setting.
//
// As of 2026-06-15 the scored index is FULLY AUTO — 3 components (CHI-1/3/5), each
// 0 / 0.5 / 1 (max 3). Three former components are off the scored index:
//   • CHI-2 (demand-side enforcement) — DROPPED: its signal (the market keeping ETH's
//     collateral primacy) is already what CHI-1's net ETH-vs-stable collateral drift
//     measures, and its counterfactual leg ("restrict ETH → lose share") is unattributable.
//   • CHI-4 (institutional tabularization) — DEMOTED to an unscored milestone: the
//     evidence (regulated collateral schedules / clearinghouse rulebooks, "live vs
//     announced", haircut reads) has no keyless feed, so it is user-fed and does NOT
//     move the index. Rendered in the Factory watch panel ("Codification depth" card).
//   • CHI-6 (duration) — DROPPED: on-chain fixed-term ETH credit is <$5M and dormant
//     (Notional V3 → $0; Pendle is a RATE/yield market, not collateral credit), with no
//     keyless maturity feed. A term structure for ETH credit does not exist on-chain yet —
//     there is nothing faithful to score.

export const STATED_PRIOR = {
  // Label everywhere as a STATED ANALYST PRIOR, not a model output.
  base: { branchPct: 32, p10k: 30, p20k: 12 },
  fairValueBandUsd: [1200, 2500], // thesis-FALSE fair value per coin
  fairValueMcapUsdT: [0.15, 0.3], // thesis-FALSE fair value, market cap (≈ $1,200–2,500/coin × ~120.7M ETH)
};

// CHI total -> probability band. Evaluated top-down. Thresholds rescaled to the 3-component
// (max 3) index; the probability priors themselves are unchanged. On track ≥2.5 (83%),
// Hardening ≥1.5 (50%), Schelling-retired ≤0.5 + CHI-3 reverse lit.
export function mapProbabilities(total, reverseLit) {
  if (total >= 2.5)
    return { branchPct: 53, p10k: 45, p20k: 22, status: 'On track', tone: 'good' };
  if (total >= 1.5)
    return { branchPct: 42, p10k: 38, p20k: 17, status: 'Hardening', tone: 'warm' };
  if (total <= 0.5 && reverseLit)
    return {
      branchPct: 25, p10k: null, p20k: null,
      status: 'Thesis dying', label: 'Schelling thesis RETIRED', tone: 'dead',
    };
  return { branchPct: 32, p10k: 30, p20k: 12, status: 'Stalled / awaiting', tone: 'base' };
}

// Static metadata for each SCORED component. `mode` drives the AUTO/MANUAL badge.
export const CHI_COMPONENTS = [
  {
    id: 'CHI-1', key: 'chi1', name: 'Stress survival', mode: 'auto+manual',
    threshold:
      'Through any ≥50% ETH drawdown, the ETH-system NET collateral share across Aave/Morpho/Sky (Sky USDC PSM, pure lenders and same-class loops excluded) falls ≤5pp AND no top venue delists ETH or cuts max LTV >10pp.',
    source: { label: 'DefiLlama + Morpho API + CoinGecko', url: 'https://defillama.com/protocol/aave-v3' },
  },
  {
    id: 'CHI-3', key: 'chi3', name: 'Slashable ETH bond demand', mode: 'auto',
    threshold:
      'ETH restaked across EigenLayer / Symbiotic / Karak, ETH-denominated (price-stripped). Lights at ≥5M ETH bonded; ≥1M = partial; reverse (Schelling-retired) if it collapses <1M. Headline TVL over-reads — points-farming, LST double-count, non-live-slashing AVSs.',
    source: { label: 'DefiLlama Restaking', url: 'https://defillama.com/protocols/Restaking' },
  },
  {
    id: 'CHI-5', key: 'chi5', name: 'Volatility / haircut regime', mode: 'auto',
    threshold:
      'ETH trailing-365d realized vol persistently <50% (annualized daily log returns; persistent = ≥2 consecutive quarters) AND ETH\'s on-chain max-LTV tier rising (= haircut compressing) across Aave/Morpho.',
    source: { label: 'CoinGecko + Morpho API', url: 'https://www.coingecko.com/en/coins/ethereum' },
  },
];

const litOf = (score) => score >= 0.5;
const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);

// --- per-component scorers. Each returns { score, valueText, detail, extra? } ---

// CHI-1: AUTO tracks the NET ETH collateral share + drawdown; manual confirms no delist/LTV cut.
// Seed = 0.5 (2022 passed eligibility, but stablecoin/T-bill collateral wasn't yet at
// scale — so the real test is the *next* ≥50% drawdown).
function chi1(auto, manual) {
  const share = num(auto?.collateral?.combinedEthSharePct);
  const dd = num(auto?.eth?.drawdownFromPeakPct); // positive magnitude, e.g. 34 => -34%
  const delta = num(auto?.collateral?.combinedEthShareDeltaPp);
  const m = manual?.chi1_stress || {};
  const resolved = m.episode_through_50dd === true;

  let score = 0.5;
  let stressActive = false;
  let detail =
    'Seed 0.5 — eligibility held through the 2022 drawdown, but stablecoin/T-bill collateral was not yet at scale. The real test is the next ≥50% drawdown.';

  if (resolved) {
    // The operator recorded a COMPLETED ≥50% drawdown episode → the resolved verdict
    // takes over and overrides the live branch (→ 1 survived / 0 failed).
    const deltaOk = num(m.share_delta_pp) !== null && Math.abs(m.share_delta_pp) <= 5;
    const noDelist = m.no_delist_or_ltv_cut === true;
    if (deltaOk && noDelist) {
      score = 1;
      detail = `Survived a ≥50% drawdown: ETH-system collateral share moved ${m.share_delta_pp}pp (≤5pp) with no delist / LTV cut >10pp. Convention held under stress.`;
    } else {
      score = 0;
      detail = `Failed the stress test: share Δ ${m.share_delta_pp ?? '?'}pp and/or a delist/LTV cut occurred during a ≥50% drawdown.`;
    }
  } else if (dd !== null && dd >= 50) {
    // STRESS-LIVE (A2): the ≥50% drawdown the seed treats as a *future* test is happening
    // NOW, and the auto net-collateral leg already carries a real signal. Score from it
    // instead of holding the neutral seed — a live soft-fail must read BELOW 0.5.
    stressActive = true;
    if (delta !== null && delta <= -5) {
      score = 0.25; // soft fail — strictly below the neutral seed, never reads as neutral
      detail = `⚠ Stress test ACTIVE — amid the current −${dd.toFixed(0)}% drawdown the ETH-system NET collateral share has fallen ${Math.abs(delta)}pp (>5pp), a soft fail of the ≤5pp light condition. Pending no-delist / LTV-cut confirmation (manual leg unset).`;
    } else {
      score = 0.5; // holding under stress — the auto leg is within tolerance
      const driftPhrase = delta !== null ? `is ${delta >= 0 ? '+' : ''}${delta}pp (within ≤5pp)` : 'drift is still accruing (cannot confirm ≤5pp yet)';
      detail = `Holding under stress — amid the current −${dd.toFixed(0)}% drawdown the ETH-system NET collateral share ${driftPhrase}. The no-delist / LTV-cut leg is still pending (manual, unset).`;
    }
  }

  const driftTxt = delta !== null ? ` · share ${delta >= 0 ? '+' : ''}${delta}pp over tracked window` : '';
  const valueText =
    share !== null
      ? `ETH-system NET collateral ${share.toFixed(1)}%${driftTxt} · drawdown from peak ${dd !== null ? '−' + dd.toFixed(0) + '%' : 'n/a'}`
      : 'Awaiting collateral data';
  return { score, stressActive, valueText, detail };
}

// CHI-3: AUTO. ETH used as a slashable security bond — proxied by ETH restaked
// (EigenLayer + Symbiotic + Karak), ETH-denominated to strip price. Caveat: headline
// restaking TVL includes points-farming, LST double-counting and non-live-slashing
// AVSs, so it OVER-reads genuine bond demand — treat as an upper bound. The reverse
// signal (Schelling-retired proxy) fires if generalized ETH bonding collapses <1M ETH.
function chi3(auto, _manual) {
  const eth = num(auto?.restaking?.restakedEth);
  const ratio = num(auto?.restaking?.restakedToStakedPct);
  if (eth === null)
    return { score: 0, valueText: 'Awaiting restaking data', detail: 'ETH restaked across EigenLayer / Symbiotic / Karak (ETH-denominated). Lights at ≥5M ETH bonded; ≥1M = partial.' };
  let score = 0;
  if (eth >= 5_000_000) score = 1;
  else if (eth >= 1_000_000) score = 0.5;
  const reverse = eth < 1_000_000;
  const m = (eth / 1e6).toFixed(2);
  return {
    score,
    reverse,
    valueText: `${m}M ETH restaked${ratio !== null ? ` · ${ratio}% of staked ETH` : ''}`,
    detail: reverse
      ? 'REVERSE SIGNAL: ETH restaked has collapsed below 1M — generalized slashable-bond demand is failing. If CHI ≤ 1.0 the Schelling thesis is flagged RETIRED.'
      : `${m}M ETH restaked (EigenLayer+Symbiotic+Karak, ETH-denominated). Lights at ≥5M; ≥1M = partial. NB: headline TVL over-reads real demand (points-farming, LST double-count, non-live-slashing AVSs).`,
  };
}

// CHI-5: AUTO (both legs). Leg 1 — trailing-365d realized vol <50% for ≥2 quarters.
// Leg 2 — ETH's on-chain max-LTV tier is RISING (haircut compressing): on-chain LTV is
// literally a haircut (LTV 86% = 14% haircut), so a rising max-LTV across Aave/Morpho is
// the on-chain analog of regulated-venue haircuts trending down. The trend delta is
// computed in fetch.mjs against the longitudinal log; it is null until ≥1 prior reading
// exists, so the haircut leg stays unconfirmed (no day-1 inflation), then accrues.
function chi5(auto, _manual) {
  const vol365 = num(auto?.vol?.d365Pct);
  const vol30 = num(auto?.vol?.d30Pct);
  const quartersUnder = num(auto?.vol?.quartersUnder50);
  const lltv = num(auto?.collateral?.ethMaxLltvPct);
  const lltvDelta = num(auto?.collateral?.ethMaxLltvDeltaPp);
  // Field-level feed health for the haircut leg (A1). Set by fetch.mjs from whether the
  // Morpho max-LTV sub-fetch succeeded: 'ok' | 'stale' (carried forward) | 'failed'.
  // Legacy snapshots predate the field → infer from whether a value is present.
  const lltvStatus = auto?.collateral?.ethMaxLltvStatus
    ?? (lltv !== null ? 'ok' : 'failed');
  const feedBroken = lltvStatus === 'failed';
  const feedStale = lltvStatus === 'stale';
  const feedFresh = lltvStatus === 'ok';

  const under50 = vol365 !== null && vol365 < 50;
  // Persistence: ≥2 consecutive quarters <50%. Accrues from history; until we have
  // ≥2 quarters of our own record, fall back to the current reading.
  const persistent = quartersUnder !== null ? quartersUnder >= 2 : under50;
  const volLeg = under50 && persistent;

  // Haircut compressing = on-chain max-LTV up ≥1pp since the first logged reading. Only a
  // FRESH feed can confirm it — a broken/stale feed must never read as "compressing" or
  // (the A1 bug) as the benign "accruing" state, which is reserved for: feed OK but <2
  // history points yet.
  const compressing = feedFresh && lltvDelta !== null && lltvDelta >= 1;
  const legs = (volLeg ? 1 : 0) + (compressing ? 1 : 0);
  const score = legs === 2 ? 1 : legs === 1 ? 0.5 : 0;

  const lltvTxt = lltv !== null
    ? ` · ETH max-LTV ${lltv.toFixed(0)}%${feedStale ? ' (stale)' : lltvDelta !== null ? ` (${lltvDelta >= 0 ? '+' : ''}${lltvDelta}pp)` : ''}`
    : feedBroken ? ' · ETH max-LTV feed broken' : '';
  const valueText =
    vol365 !== null
      ? `RV365 ${vol365.toFixed(0)}% ${under50 ? '(<50% ✓)' : '(≥50%)'} · RV30 ${vol30 !== null ? vol30.toFixed(0) + '%' : '—'}${lltvTxt}`
      : 'Awaiting vol';
  const haircutRead =
    feedBroken ? 'feed unavailable / broken — Morpho max-LTV sub-fetch failed'
      : feedStale ? 'stale — last good max-LTV carried forward; awaiting a fresh fetch'
      : compressing ? 'confirmed (rising)'
      : lltvDelta === null ? 'accruing (need a prior reading)'
      : 'not compressing';
  return {
    score,
    feedStatus: lltvStatus,
    feedBroken,
    valueText,
    detail: `Vol leg — trailing-365d realized vol <50% for ≥2 quarters: ${volLeg ? 'met' : 'not met'}. On-chain haircut leg — ETH max-LTV (Aave/Morpho) compressing the haircut: ${haircutRead}${lltv !== null ? ` · current haircut ≈ ${(100 - lltv).toFixed(0)}%` : ''}.`,
  };
}

const SCORERS = { chi1, chi3, chi5 };

// computeCHI(snapshot) where snapshot = { auto, manual } (the latest.json object works
// directly). Returns the 3 scored components + total + probabilities. CHI-4 (institutional)
// is an unscored milestone rendered separately in the Factory watch panel.
export function computeCHI(snapshot) {
  const auto = snapshot?.auto || {};
  const manual = snapshot?.manual || {};
  let reverseLit = false;

  const components = CHI_COMPONENTS.map((meta) => {
    const r = SCORERS[meta.key](auto, manual);
    if (meta.key === 'chi3' && r.reverse) reverseLit = true;
    return {
      ...meta,
      score: r.score,
      lit: litOf(r.score),
      valueText: r.valueText,
      detail: r.detail,
      reverse: !!r.reverse,
      feedStatus: r.feedStatus,
      feedBroken: !!r.feedBroken,
      stressActive: !!r.stressActive,
      source: r.source ? { label: 'manual', url: r.source } : meta.source,
    };
  });

  // Round to 0.01, NOT 0.5: CHI-1's stress-live soft-fail (0.25) makes quarter-step totals
  // possible (e.g. 0.25+0.5+0 = 0.75). Rounding to 0.5 would round 0.75 back up to 1.0 and
  // hide the soft-fail in the headline.
  const total = Math.round(components.reduce((a, c) => a + c.score, 0) * 100) / 100;
  const litCount = components.filter((c) => c.lit).length;
  const probabilities = mapProbabilities(total, reverseLit);

  return { components, total, litCount, reverseLit, probabilities };
}
