// Convention Hardening Index (CHI) — shared scoring engine.
//
// Imported by BOTH scripts/fetch.mjs (Node) and the React UI (Vite) so that the
// score and probability mapping are computed from a single source of truth. Pure
// functions only — no Node- or browser-specific APIs.
//
// Thesis under test: ETH's only durable value channel is becoming the *capital
// stock* of open on-chain finance (native, non-freezable, slashable, yield-bearing
// collateral) — NOT transaction fees. CHI scores how hard the "market convention"
// factory is setting. Each of 6 components scores 0 / 0.5 / 1 (max 6).

export const STATED_PRIOR = {
  // Label everywhere as a STATED ANALYST PRIOR, not a model output.
  base: { branchPct: 32, p10k: 30, p20k: 12 },
  fairValueBandUsd: [1200, 2500], // thesis-FALSE fair value per coin
  fairValueMcapUsdT: [1.5, 3.0], // thesis-FALSE fair value, market cap
};

// CHI total -> probability band. Evaluated top-down.
export function mapProbabilities(total, reverseLit) {
  if (total >= 5.0)
    return { branchPct: 53, p10k: 45, p20k: 22, status: 'On track', tone: 'good' };
  if (total >= 3.5)
    return { branchPct: 42, p10k: 38, p20k: 17, status: 'Hardening', tone: 'warm' };
  if (total <= 1.5 && reverseLit)
    return {
      branchPct: 25, p10k: null, p20k: null,
      status: 'Thesis dying', label: 'Schelling thesis RETIRED', tone: 'dead',
    };
  return { branchPct: 32, p10k: 30, p20k: 12, status: 'Stalled / awaiting', tone: 'base' };
}

// Static metadata for each component. `mode` drives the AUTO/MANUAL badge.
export const CHI_COMPONENTS = [
  {
    id: 'CHI-1', key: 'chi1', name: 'Stress survival', mode: 'auto+manual',
    threshold:
      'Through any ≥50% ETH drawdown, ETH-system collateral share across Aave/Morpho/Sky falls ≤5pp AND no top venue delists ETH or cuts max LTV >10pp.',
    source: { label: 'DefiLlama + CoinGecko', url: 'https://defillama.com/protocol/aave-v3' },
  },
  {
    id: 'CHI-2', key: 'chi2', name: 'Demand-side enforcement', mode: 'manual',
    threshold:
      'A venue restricting ETH collateral demonstrably loses TVL share, OR ETH retains the top LTV tier in venues that also list tokenized-treasury collateral.',
    source: { label: 'manual', url: '' },
  },
  {
    id: 'CHI-3', key: 'chi3', name: 'Mandatory slashable ETH bond', mode: 'manual',
    threshold:
      '≥3 LIVE systems across ≥2 categories (preconf / based-sequencing / solver-intent / agent-escrow / cross-chain insurance) REQUIRE an ETH-denominated slashable bond, ≥5M ETH bound aggregate.',
    source: { label: 'manual', url: '' },
  },
  {
    id: 'CHI-4', key: 'chi4', name: 'Institutional tabularization', mode: 'manual',
    threshold:
      '≥2 regulated venues (prime broker, CCP/clearinghouse, or regulated margin program) list ETH on a collateral eligibility schedule with haircut ≤40%, LIVE (not announced).',
    source: { label: 'manual', url: '' },
  },
  {
    id: 'CHI-5', key: 'chi5', name: 'Volatility / haircut regime', mode: 'auto+manual',
    threshold:
      'ETH trailing-365d realized vol persistently <50% (annualized, daily log returns; persistent = <50% for ≥2 consecutive quarters) AND regulated-venue haircut quotes trending down.',
    source: { label: 'CoinGecko + manual', url: 'https://www.coingecko.com/en/coins/ethereum' },
  },
  {
    id: 'CHI-6', key: 'chi6', name: 'Duration', mode: 'manual',
    threshold:
      'Fixed-term (≥90-day) borrowing against ETH collateral ≥10% of total ETH-collateralized debt (Pendle / Morpho fixed-term / Term Finance / Notional).',
    source: { label: 'manual', url: '' },
  },
];

const litOf = (score) => score >= 0.5;
const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);

// --- per-component scorers. Each returns { score, valueText, detail, extra? } ---

// CHI-1: AUTO tracks collateral share + drawdown; manual confirms no delist/LTV cut.
// Seed = 0.5 (2022 passed eligibility, but stablecoin/T-bill collateral wasn't yet at
// scale — so the real test is the *next* ≥50% drawdown).
function chi1(auto, manual) {
  const share = num(auto?.collateral?.combinedEthSharePct);
  const dd = num(auto?.eth?.drawdownFromPeakPct); // positive magnitude, e.g. 34 => -34%
  const m = manual?.chi1_stress || {};
  let score = 0.5;
  let detail =
    'Seed 0.5 — eligibility held through the 2022 drawdown, but stablecoin/T-bill collateral was not yet at scale. The real test is the next ≥50% drawdown.';
  if (m.episode_through_50dd === true) {
    const deltaOk = num(m.share_delta_pp) !== null && Math.abs(m.share_delta_pp) <= 5;
    const noDelist = m.no_delist_or_ltv_cut === true;
    if (deltaOk && noDelist) {
      score = 1;
      detail = `Survived a ≥50% drawdown: ETH-system collateral share moved ${m.share_delta_pp}pp (≤5pp) with no delist / LTV cut >10pp. Convention held under stress.`;
    } else {
      score = 0;
      detail = `Failed the stress test: share Δ ${m.share_delta_pp ?? '?'}pp and/or a delist/LTV cut occurred during a ≥50% drawdown.`;
    }
  }
  const delta = num(auto?.collateral?.combinedEthShareDeltaPp);
  const driftTxt = delta !== null ? ` · share ${delta >= 0 ? '+' : ''}${delta}pp over tracked window` : '';
  const valueText =
    share !== null
      ? `ETH-system collateral ${share.toFixed(1)}%${driftTxt} · drawdown from peak ${dd !== null ? '−' + dd.toFixed(0) + '%' : 'n/a'}`
      : 'Awaiting collateral data';
  if (score === 0.5 && delta !== null && delta <= -5 && dd !== null && dd >= 50) {
    detail += ` ⚠ Caution: amid the current −${dd.toFixed(0)}% drawdown, ETH-system collateral share has fallen ${Math.abs(delta)}pp (>5pp) as stablecoin/T-bill collateral gains — a soft fail of the light condition, pending the manual delist/LTV check.`;
  }
  return { score, valueText, detail };
}

// CHI-2: MANUAL (semi-auto support).
function chi2(_auto, manual) {
  const m = manual?.chi2_demand_enforcement || {};
  const score = m.lit === true ? 1 : 0;
  return {
    score,
    valueText: m.lit === true ? 'Lit — eligibility premium survived competition' : 'Awaiting',
    detail:
      m.note ||
      'Lights when an ETH-restricting venue loses TVL share, or ETH keeps the top LTV tier where tokenized-treasuries also compete.',
    source: m.source || '',
  };
}

// CHI-3: MANUAL. Reverse signal (−0.5) triggers the Schelling-retired check.
function chi3(_auto, manual) {
  const m = manual?.chi3_mandatory_bond || {};
  const systems = Array.isArray(m.systems) ? m.systems.filter((s) => s && s.mandatory && s.live) : [];
  const cats = new Set(systems.map((s) => s.category).filter(Boolean));
  const ethBound = systems.reduce((a, s) => a + (Number(s.eth_bound) || 0), 0);
  let score = 0;
  if (systems.length >= 3 && cats.size >= 2 && ethBound >= 5_000_000) score = 1;
  else if (systems.length >= 1) score = 0.5;
  const reverse = m.reverse_signal === true;
  if (reverse) score = Math.max(0, score - 0.5);
  const valueText = systems.length
    ? `${systems.length} live mandatory · ${cats.size} categor${cats.size === 1 ? 'y' : 'ies'} · ${(ethBound / 1e6).toFixed(2)}M ETH bound`
    : 'Awaiting — 0 live mandatory ETH-bond systems';
  return {
    score,
    reverse,
    valueText,
    detail: reverse
      ? 'REVERSE SIGNAL active (−0.5): a top-2 standard in some category adopted multi-asset / stablecoin bonding. If CHI ≤ 1.5 the Schelling thesis is flagged RETIRED.'
      : 'Lights at ≥3 live systems across ≥2 categories requiring ETH-denominated slashable bonds, ≥5M ETH bound aggregate.',
  };
}

// CHI-4: MANUAL.
function chi4(_auto, manual) {
  const m = manual?.chi4_institutional || {};
  const venues = Array.isArray(m.venues)
    ? m.venues.filter((v) => v && v.live && typeof v.haircut_pct === 'number' && v.haircut_pct <= 40)
    : [];
  let score = 0;
  if (venues.length >= 2) score = 1;
  else if (venues.length === 1) score = 0.5;
  return {
    score,
    valueText: venues.length ? `${venues.length} live venue(s), haircut ≤40%` : 'Awaiting — 0 live regulated venues',
    detail: 'Lights at ≥2 regulated venues (PB / CCP / margin program) listing ETH on a collateral schedule with haircut ≤40%, LIVE.',
  };
}

// CHI-5: AUTO (vol) + MANUAL (haircut trend).
function chi5(auto, manual) {
  const vol365 = num(auto?.vol?.d365Pct);
  const vol30 = num(auto?.vol?.d30Pct);
  const quartersUnder = num(auto?.vol?.quartersUnder50);
  const m = manual?.chi5_haircut_trend || {};
  const under50 = vol365 !== null && vol365 < 50;
  // Persistence: ≥2 consecutive quarters <50%. Accrues from history; until we have
  // ≥2 quarters of our own record, fall back to the current reading.
  const persistent = quartersUnder !== null ? quartersUnder >= 2 : under50;
  const autoLeg = under50 && persistent;
  const compressing = m.compressing === true;
  const legs = (autoLeg ? 1 : 0) + (compressing ? 1 : 0);
  const score = legs === 2 ? 1 : legs === 1 ? 0.5 : 0;
  const valueText =
    vol365 !== null
      ? `RV365 ${vol365.toFixed(0)}% ${under50 ? '(<50% ✓)' : '(≥50%)'} · RV30 ${vol30 !== null ? vol30.toFixed(0) + '%' : '—'}`
      : 'Awaiting vol';
  return {
    score,
    valueText,
    detail: `Auto leg — trailing-365d realized vol <50% for ≥2 quarters: ${autoLeg ? 'met' : 'not met'}. Manual leg — regulated-venue haircuts compressing: ${compressing ? 'confirmed' : 'unconfirmed'}.`,
  };
}

// CHI-6: MANUAL (semi-auto).
function chi6(_auto, manual) {
  const pct = num(manual?.chi6_term_share_pct);
  if (pct === null) {
    return {
      score: 0,
      valueText: 'Awaiting',
      detail: 'Fixed-term (≥90d) ETH-collateral borrowing as a share of total ETH-collateral debt. Lights at ≥10%.',
    };
  }
  let score = 0;
  if (pct >= 10) score = 1;
  else if (pct >= 5) score = 0.5;
  return {
    score,
    valueText: `${pct}% in fixed-term (≥90d) borrowing`,
    detail: 'Lights at ≥10% of ETH-collateral debt in fixed-term (≥90d) borrowing (Pendle / Morpho fixed-term / Term / Notional).',
  };
}

const SCORERS = { chi1, chi2, chi3, chi4, chi5, chi6 };

// computeCHI(snapshot) where snapshot = { auto, manual } (the latest.json object works
// directly). Returns components + total + probabilities, recomputed live.
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
      source: r.source ? { label: 'manual', url: r.source } : meta.source,
    };
  });

  const total = Math.round(components.reduce((a, c) => a + c.score, 0) * 2) / 2;
  const litCount = components.filter((c) => c.lit).length;
  const probabilities = mapProbabilities(total, reverseLit);

  return { components, total, litCount, reverseLit, probabilities };
}
