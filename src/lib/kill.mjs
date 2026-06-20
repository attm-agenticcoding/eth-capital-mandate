// Kill-Criteria scorecard — the structural FALSIFICATION engine.
//
// Companion to chi.mjs (the confirm side). Where the CHI scores how hard the
// capital-mandate convention is *setting*, this scores the original thesis
// KILL CRITERIA — the structural disconfirming signals, with the stated decision
// rule: over a 3–5 year window, ≥3 sustained hits → seriously consider exit.
// These are STRUCTURAL signals, not price stops.
//
// Pure functions only (no Node/browser APIs beyond Date.now) so the UI and
// fetch.mjs share one source of truth, exactly like chi.mjs.
//
// Two kinds of criterion — the distinction matters for what counts as a "hit":
//   • LEVEL   — a threshold cross is itself a structural regression (e.g. stablecoin
//               share falling through a floor). Can hit immediately; the persistence-
//               required ones (KC-5/6 say "持续/sustained") sit on `watch` until the
//               breach is sustained, accruing from our own log.
//   • DEADLINE — the criterion is "within N years" (KC-1 5y, KC-4 3y, KC-7 2y). A
//               condition that is currently true is EXPECTED this early and is NOT a
//               hit yet — it shows `watch` until the horizon elapses with the
//               condition still true. This stops the scorecard from over-firing at
//               thesis year ~0 (when, by construction, the market hasn't priced it).
//
// status:  intact (healthy) · watch (met-but-not-yet-a-hit) · hit (structural fail) ·
//          awaiting (no data / manual leg unset). Only `hit` counts toward the ≥3 rule.

export const EXIT_THRESHOLD = 3; // ≥3 hits → consider exit
// B1 (proposal, off by default): per-criterion weights for the `weighted` exit rule. KC-1 is
// the thesis's core proposition (cash flow + premium both fail); KC-3 the settlement layer.
export const KC_EXIT_WEIGHTS = { 'KC-1': 2, 'KC-3': 1.5 }; // others default to 1
// KCs whose single hit raises an independent red alert under `single_hit_override`.
export const KC_DECISIVE = ['KC-1', 'KC-3'];
export const THESIS_CLOCK_DEFAULT = '2025-01-01'; // anchor for DEADLINE criteria; overridable via manual.json

// Chains treated as "Ethereum-aligned" for KC-2's payment-layer share (mainnet + ETH-settled
// rollups). Opinionated and meant to be tuned — Polygon PoS is included as ETH-settled by
// convention. Mirrored in fetch.mjs (getStablecoins) where the aggregate is actually computed.
export const ETH_ALIGNED_CHAINS = [
  'Ethereum', 'Base', 'Arbitrum', 'OP Mainnet', 'Optimism', 'Polygon', 'Polygon zkEVM',
  'zkSync Era', 'Scroll', 'Linea', 'Starknet', 'Mantle', 'Blast', 'Mode', 'Zora', 'Taiko',
  'Manta', 'Metis', 'Fraxtal', 'Ink', 'Soneium', 'Unichain', 'World Chain', 'Abstract',
];

// A6: the STRICT Ethereum-aligned set = mainnet + only rollups that genuinely settle to AND
// post data-availability on Ethereum. Excludes the weakest-alignment chains in the broad
// list: Polygon PoS (sidechain / commit-chain, not a rollup) and external-/alt-DA chains
// that do NOT post DA to Ethereum by default — Mantle (EigenDA), Manta (Celestia),
// Metis (off-chain DAC), Fraxtal (own DA layer). Display + divergence ONLY — which set
// KC-2/KC-3 actually SCORE against is a semantic choice deferred to B2.
const STRICT_ALIGNMENT_EXCLUDE = new Set(['Polygon', 'Mantle', 'Manta', 'Metis', 'Fraxtal']);
export const ETH_ALIGNED_CHAINS_STRICT = ETH_ALIGNED_CHAINS.filter((c) => !STRICT_ALIGNMENT_EXCLUDE.has(c));

export const KILL_CRITERIA = [
  {
    id: 'KC-1', key: 'kc1', name: 'Cash flow + monetary premium 双双落空', kind: 'deadline', horizonYrs: 5, mode: 'auto',
    threshold:
      'Within 5 years: L1+blob revenue never grows AND ETH still trades like pure beta / utility token with no reserve/collateral premium. HIT = both legs still true at the 5-year horizon. Auto legs: L1 take-rate ≈0 (<0.5%/yr) AND ETH/BTC 90d correlation >0.85.',
    source: { label: 'growthepie + CoinGecko', url: 'https://www.growthepie.xyz' },
  },
  {
    id: 'KC-2', key: 'kc2', name: '支付层流失', kind: 'level', mode: 'auto',
    threshold:
      'Ethereum-aligned chains’ share of all stablecoin supply (mainnet + ETH-settled rollups) falls from ~50% through 35%. HIT <35%, watch <40%.',
    source: { label: 'DefiLlama Stablecoins', url: 'https://defillama.com/stablecoins' },
  },
  {
    id: 'KC-3', key: 'kc3', name: '机构结算层旁落', kind: 'level', mode: 'auto',
    threshold:
      'The next cohort of asset-management / RWA products mostly does NOT pick Ethereum. Proxy: Ethereum-system share of tokenized RWA value falls below 50% (a majority no longer choose ETH). The truer flow read — share of NEW RWA value added — accrues from our own log.',
    source: { label: 'DefiLlama RWA', url: 'https://defillama.com/protocols/RWA' },
  },
  {
    id: 'KC-4', key: 'kc4', name: 'L2 价值回流停滞', kind: 'deadline', horizonYrs: 3, mode: 'auto+manual',
    threshold:
      'Within 3 years no top-tier L2 reaches Stage 2 AND adopts based sequencing. HIT = horizon elapses with the milestone still unmet. Auto context: top-5 L2 paid-to-L1 ÷ L2 revenue (the economic reflow). The Stage-2/based-sequencing milestone is a user-fed leg (no clean keyless feed).',
    source: { label: 'growthepie + L2BEAT (manual milestone)', url: 'https://l2beat.com/scaling/summary' },
  },
  {
    id: 'KC-5', key: 'kc5', name: '货币政策失信', kind: 'level', mode: 'auto+manual',
    threshold:
      'Long-run NET issuance stays >2–3%/yr, OR the issuance curve is repeatedly raised by governance. Mild inflation alone does NOT count — issuance pays for the slashable security bond. HIT = net issuance >3%/yr sustained, or a governance leg flagged; watch in the 2–3% band.',
    source: { label: 'ultrasound.money', url: 'https://ultrasound.money' },
  },
  {
    id: 'KC-6', key: 'kc6', name: '被 Solana 全面超车', kind: 'level', mode: 'auto',
    threshold:
      'Solana’s DeFi TVL / stablecoin / RWA growth persistently and materially outpaces the Ethereum stack. HIT = Solana overtakes Ethereum on all-chain TVL share; watch = Solana gaining share faster than ETH across metrics (accrues from our log). Levels alone can’t answer "who grows faster" — the growth delta accrues.',
    source: { label: 'DefiLlama Chains', url: 'https://defillama.com/chains' },
  },
  {
    id: 'KC-7', key: 'kc7', name: '技术护城河落空', kind: 'deadline', horizonYrs: 2, mode: 'manual',
    threshold:
      'No material progress within 2 years on the promised AI-assisted formal-verification roadmap. No keyless feed — a user-fed read. HIT = horizon elapses with no material progress confirmed.',
    source: { label: 'manual watch', url: '' },
  },
];

const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

function yearsSince(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return null;
  return (Date.now() - t) / (365.25 * 86400 * 1000);
}
function horizonEnd(iso, yrs) {
  const d = new Date(iso || THESIS_CLOCK_DEFAULT);
  if (!isFinite(d.getTime())) return null;
  d.setUTCFullYear(d.getUTCFullYear() + yrs);
  return d.toISOString().slice(0, 10);
}
// A3: a DEADLINE criterion whose condition is fully met and whose clock has passed ≥60%
// of its horizon is `elevated` — a progressive warning so it doesn't jump straight from
// `watch` to `hit` at the cliff with no intermediate signal. Still `watch` (NOT a hit).
const ELEVATED_FRACTION = 0.6;
function deadlineElevated(yrs, horizonYrs) {
  return yrs !== null && yrs >= ELEVATED_FRACTION * horizonYrs;
}
// trailing run of history rows (oldest→newest log) that satisfy pred, counted from the end
function trailingStreak(hist, pred) {
  if (!Array.isArray(hist)) return 0;
  let n = 0;
  for (let i = hist.length - 1; i >= 0; i--) {
    if (pred(hist[i])) n++; else break;
  }
  return n;
}
// change in a numeric field from the oldest logged value to the newest (null until ≥2 exist)
function deltaSinceOldest(hist, field) {
  if (!Array.isArray(hist)) return null;
  const vals = hist.map((r) => r && r[field]).filter((v) => typeof v === 'number' && isFinite(v));
  return vals.length >= 2 ? r1(vals[vals.length - 1] - vals[0]) : null;
}
// A7: share of NEW value added = Δ(numerator) ÷ Δ(denominator) across the logged window —
// the true flow read (e.g. ETH's share of NEW RWA value), distinct from the change in ETH's
// own stock share. Null ("accruing") until ≥2 points exist and the market actually grew.
export function flowShareSinceOldest(hist, numField, denField) {
  if (!Array.isArray(hist)) return null;
  const rows = hist.filter((r) => r && typeof r[numField] === 'number' && isFinite(r[numField]) && typeof r[denField] === 'number' && isFinite(r[denField]));
  if (rows.length < 2) return null;
  const dNum = rows[rows.length - 1][numField] - rows[0][numField];
  const dDen = rows[rows.length - 1][denField] - rows[0][denField];
  if (!(dDen > 0)) return null; // no net new value to attribute yet (market flat/shrinking)
  return r1((dNum / dDen) * 100);
}

// --- per-criterion scorers. Each: (auto, manual, hist, clock) => { status, valueText, detail } ---

// KC-1 (DEADLINE 5y): cash flow dead AND no monetary premium. Both true this early is
// the thesis's *starting* condition, not a falsification — so `watch` until the horizon.
function kc1(auto, _m, _h, clock) {
  const take = num(auto?.fees?.takeRatePctPerYr);
  const corr = num(auto?.correlation?.now);
  if (take === null && corr === null)
    return { status: 'awaiting', valueText: 'Awaiting fees / correlation', detail: 'Needs L1 take-rate + ETH/BTC correlation.' };
  const cashflowDead = take !== null && take < 0.5; // L1+blob captures ~nothing
  const noPremium = corr !== null && corr > 0.85; // trades like pure beta
  const both = cashflowDead && noPremium;
  const yrs = yearsSince(clock);
  const end = horizonEnd(clock, 5);
  let status;
  if (!both) status = 'intact';
  else if (yrs === null || yrs < 5) status = 'watch';
  else status = 'hit';
  const elevated = status === 'watch' && deadlineElevated(yrs, 5);
  const valueText = `L1 take-rate ${take !== null ? take + '%/yr' : '—'} · ETH/BTC corr ${corr !== null ? corr.toFixed(2) : '—'}`;
  const legTxt = `cash-flow-dead ${cashflowDead ? '✓' : '✗'} · no-premium ${noPremium ? '✓' : '✗'}`;
  const detail =
    status === 'intact'
      ? `${legTxt}. At least one leg has lifted — the thesis is becoming priceable on this axis.`
      : status === 'watch'
        ? `${legTxt}. Both legs true, but this is EXPECTED pre-mandate — it only becomes a structural kill if still true at the ${end} horizon (5y).${elevated ? ` ⚠ ELEVATED: past 60% of the horizon (${yrs.toFixed(1)}y of 5y) with both legs still lit — approaching the cliff.` : ''}`
        : `${legTxt}. 5-year horizon (${end}) reached with both legs still true — cash flow and premium both failed to appear.`;
  return { status, elevated, valueText, detail };
}

// KC-2 (LEVEL): ETH-aligned stablecoin share through 35%. Falls back to mainnet-only share
// until fetch.mjs supplies the ETH-stack aggregate (then this auto-upgrades).
function kc2(auto) {
  const aligned = num(auto?.stablecoins?.ethAlignedSharePct);
  const mainnet = num(auto?.stablecoins?.ethSharePct);
  const share = aligned ?? mainnet;
  if (share === null) return { status: 'awaiting', valueText: 'Awaiting stablecoin data', detail: 'Needs DefiLlama stablecoin-by-chain.' };
  const status = share < 35 ? 'hit' : share < 40 ? 'watch' : 'intact';
  const unit = aligned != null ? 'ETH-stack' : 'ETH mainnet (stack aggregate pending next fetch)';
  return {
    status,
    valueText: `${unit} stablecoin share ${share.toFixed(1)}%`,
    detail: `Payment-layer dominance. Kill <35% (from ~50%); watch <40%. Currently ${share.toFixed(1)}% → ${status === 'intact' ? 'well clear of the floor' : status === 'watch' ? 'approaching the floor' : 'below the floor'}.`,
  };
}

// KC-3 (LEVEL + accruing flow): RWA Ethereum-system share < 50% (majority no longer choose ETH).
// Stock proxy now; the truer NEW-issuance flow share accrues from our log.
function kc3(auto, _m, hist) {
  const share = num(auto?.rwa?.ethSharePct);
  if (share === null) return { status: 'awaiting', valueText: 'Awaiting RWA data', detail: 'Needs DefiLlama RWA-by-chain.' };
  const flow = deltaSinceOldest(hist, 'rwaEthSharePct'); // pp change in ETH's OWN stock share
  // A7: the LEADING read — ETH's share of NEW RWA value added (Δ ETH RWA ÷ Δ total RWA) over
  // the logged window. Stock has huge inertia (existing BUIDL etc. keeps ETH ≥50% even if
  // every NEW product picks another chain), so the stock level hits years late. This flow
  // read leads it. Measurement only — the stock level stays the (lagging) hit trigger.
  const newIssuanceFlow = flowShareSinceOldest(hist, 'rwaEthValueUsd', 'rwaTotalUsd');
  let status;
  if (share < 50) status = 'hit';
  else if (flow !== null && flow <= -5) status = 'watch';
  else status = 'intact';
  const flowTxt = flow !== null ? ` · Δ ${flow >= 0 ? '+' : ''}${flow}pp since tracking` : ' · flow Δ accruing';
  const newIssuanceTxt = newIssuanceFlow !== null ? `${newIssuanceFlow}%` : 'accruing (need ≥2 logged points)';
  return {
    status,
    valueText: `RWA ETH-system share ${share.toFixed(1)}%${flowTxt}`,
    detail: `Institutional settlement layer. Kill = ETH stock share <50% (majority defect, the lagging trigger); watch = stock-share flow turning ≥5pp against ETH. LEADING read — ETH's share of NEW RWA value added (Δ ETH RWA ÷ Δ total RWA): ${newIssuanceTxt}. Stock has huge inertia, so this new-issuance flow leads the level.`,
  };
}

// KC-4 (DEADLINE 3y, manual milestone + auto econ context): top L2 Stage 2 + based sequencing.
function kc4(auto, manual, _h, clock) {
  const m = manual?.kill_criteria?.kc4_l2_reflow || {};
  const milestone = m.top_l2_stage2_and_based; // true (good) / false (not yet) / null (unset)
  const ratio = num(auto?.fees?.l2PaidToL1?.currentRatioPct);
  const yrs = yearsSince(clock);
  const end = horizonEnd(clock, 3);
  const ratioTxt = ratio !== null ? `L2→L1 reflow ${ratio}%` : 'reflow —';
  let status, detail;
  if (milestone === true) {
    status = 'intact';
    detail = `A top L2 reached Stage 2 + based sequencing — value-reflow path is opening. ${ratioTxt}.`;
  } else if (yrs !== null && yrs >= 3) {
    status = 'hit';
    detail = `3-year horizon (${end}) reached with no top-tier L2 at Stage 2 + based sequencing. ${ratioTxt} — reflow stalled.`;
  } else if (milestone === false) {
    status = 'watch';
    detail = `Confirmed not-yet (within the 3y window to ${end}). ${ratioTxt}.`;
  } else {
    status = 'awaiting';
    detail = `Awaiting a user read on Stage 2 + based sequencing (window to ${end}). ${ratioTxt} as the economic proxy.`;
  }
  const elevated = status === 'watch' && deadlineElevated(yrs, 3);
  if (elevated) detail += ` ⚠ ELEVATED: past 60% of the 3y horizon (${yrs.toFixed(1)}y) still unmet.`;
  return {
    status,
    elevated,
    valueText: `Stage 2 + based seq: ${milestone === true ? 'yes' : milestone === false ? 'not yet' : 'awaiting'} · ${ratioTxt}`,
    detail,
  };
}

// KC-5 (LEVEL + persistence, manual governance leg): NET issuance >2–3%/yr SUSTAINED.
// The fix: mild inflation is NEUTRAL (pays for the slashable bond) — only >3%/yr sustained,
// or a governance-raised curve, disconfirms. Computed as %/yr from net 30d annualized.
function kc5(auto, manual, hist) {
  const net30 = num(auto?.supply?.net30dEth);
  const supplyEth = num(auto?.supply?.totalSupplyEth);
  const govRaised = manual?.kill_criteria?.kc5_monetary?.issuance_curve_raised === true;
  const pctYr = net30 !== null && supplyEth ? r1((net30 / 30) * 365 / supplyEth * 100) : null;
  if (pctYr === null && !govRaised)
    return { status: 'awaiting', valueText: 'Awaiting supply data', detail: 'Needs net issuance + total supply.' };
  let status, detail;
  if (govRaised) {
    status = 'hit';
    detail = 'Governance has repeatedly raised the issuance curve — monetary credibility leg failed.';
  } else if (pctYr <= 2) {
    status = 'intact';
    detail = `Net issuance ≈${pctYr}%/yr — well under the 2–3%/yr kill line. Mild inflation does NOT count: it pays for the slashable security bond.`;
  } else if (pctYr <= 3) {
    status = 'watch';
    detail = `Net issuance ≈${pctYr}%/yr — in the 2–3% grey band. Kill only if sustained above 3%/yr.`;
  } else {
    // >3%/yr: structural only if sustained. Accrue persistence from our log.
    const streak = trailingStreak(hist, (r) => typeof r?.netIssuancePctPerYr === 'number' && r.netIssuancePctPerYr > 3);
    status = streak >= 8 ? 'hit' : 'watch'; // ~8 readings ≈ persistence; matures with the log
    detail = `Net issuance ≈${pctYr}%/yr (>3%). ${status === 'hit' ? 'Sustained above 3%/yr — monetary credibility breaking.' : 'Needs to be sustained — persistence accruing from the log.'}`;
  }
  return { status, valueText: `Net issuance ${pctYr !== null ? pctYr + '%/yr' : '—'} (kill >2–3% sustained)`, detail };
}

// KC-6 (LEVEL now + accruing growth): Solana overtaking the Ethereum stack. Levels can only
// answer "overtaken yet"; "growing faster" accrues as a share-delta race from our log.
function kc6(auto, _m, hist) {
  const ethTvl = num(auto?.chains?.ethTvl);
  const solTvl = num(auto?.chains?.solanaTvl);
  const ethShare = num(auto?.chains?.ethSharePct);
  const solShare = num(auto?.chains?.solanaSharePct);
  if (ethTvl === null || solTvl === null)
    return { status: 'awaiting', valueText: 'Awaiting chain TVL', detail: 'Needs DefiLlama chain TVL.' };
  const ratio = solTvl > 0 ? ethTvl / solTvl : null;
  const solGain = deltaSinceOldest(hist, 'solChainSharePct');
  const ethGain = deltaSinceOldest(hist, 'ethChainSharePct');
  const race = solGain !== null && ethGain !== null ? r1(solGain - ethGain) : null; // >0 = SOL gaining on ETH
  // A5: DEX-volume share is the LEADING leg — Solana's strength surfaces in throughput
  // before locked TVL, so a TVL-only KC-6 reads the overtake years late. When SOL's DEX
  // volume share crosses ETH's, escalate to watch even while TVL share still favors ETH.
  const ethVol = num(auto?.chains?.ethDexVolSharePct);
  const solVol = num(auto?.chains?.solDexVolSharePct);
  const volLeadSol = ethVol !== null && solVol !== null && solVol > ethVol;
  let status;
  if (solShare !== null && ethShare !== null && solShare > ethShare) status = 'hit'; // TVL overtaken
  else if (volLeadSol || (race !== null && race >= 5)) status = 'watch';
  else status = 'intact';
  const raceTxt = race !== null ? ` · share race ${race >= 0 ? '+' : ''}${race}pp to SOL` : ' · growth race accruing';
  const volTxt = ethVol !== null && solVol !== null
    ? ` · DEX vol ETH ${ethVol}% vs SOL ${solVol}%${volLeadSol ? ' ⚠ SOL leads' : ''}`
    : '';
  return {
    status,
    valueText: `ETH ${ratio !== null ? ratio.toFixed(1) + '×' : '—'} Solana TVL${raceTxt}${volTxt}`,
    detail: `Competitor benchmark. Kill = Solana overtakes ETH on all-chain TVL share (now ETH ${ethShare ?? '—'}% vs SOL ${solShare ?? '—'}%). Watch = SOL's leading DEX-volume share crosses ETH${ethVol !== null && solVol !== null ? ` (now ETH ${ethVol}% vs SOL ${solVol}%${volLeadSol ? ' — SOL already leads on volume' : ''})` : ''}, or SOL gaining ≥5pp faster on TVL share. Volume leads TVL; the growth race accrues from our log.`,
  };
}

// KC-7 (DEADLINE 2y, manual): AI-assisted formal-verification progress. No keyless feed.
function kc7(_a, manual, _h, clock) {
  const m = manual?.kill_criteria?.kc7_formal_verification || {};
  const prog = m.material_progress; // true (good) / false (none) / null (unset)
  const yrs = yearsSince(clock);
  const end = horizonEnd(clock, 2);
  let status, detail;
  if (prog === true) {
    status = 'intact';
    detail = `Material progress confirmed on AI-assisted formal verification.`;
  } else if (yrs !== null && yrs >= 2 && prog !== true) {
    status = 'hit';
    detail = `2-year horizon (${end}) reached with no material progress on formal verification — technical moat leg failed.`;
  } else if (prog === false) {
    status = 'watch';
    detail = `Confirmed no material progress yet (within the 2y window to ${end}).`;
  } else {
    status = 'awaiting';
    detail = `Awaiting a user read (window to ${end}). No keyless feed — user-fed milestone.`;
  }
  const elevated = status === 'watch' && deadlineElevated(yrs, 2);
  if (elevated) detail += ` ⚠ ELEVATED: past 60% of the 2y horizon (${yrs.toFixed(1)}y) still unmet.`;
  return { status, elevated, valueText: `Formal verification: ${prog === true ? 'progressing' : prog === false ? 'no progress' : 'awaiting'}`, detail };
}

const SCORERS = { kc1, kc2, kc3, kc4, kc5, kc6, kc7 };

// computeKill(snapshot, hist) — snapshot = { auto, manual } (latest.json works directly).
// hist = parsed history.json rows (for trend/persistence legs); optional.
export function computeKill(snapshot, hist = []) {
  const auto = snapshot?.auto || {};
  const manual = snapshot?.manual || {};
  const clock = manual?.kill_criteria?.thesis_clock_start || THESIS_CLOCK_DEFAULT;

  const criteria = KILL_CRITERIA.map((meta) => {
    const r = SCORERS[meta.key](auto, manual, hist, clock);
    return { ...meta, status: r.status, hit: r.status === 'hit', elevated: !!r.elevated, valueText: r.valueText, detail: r.detail };
  });

  const hitCount = criteria.filter((c) => c.status === 'hit').length;
  const watchCount = criteria.filter((c) => c.status === 'watch').length;
  const awaitingCount = criteria.filter((c) => c.status === 'awaiting').length;
  const countTriggered = hitCount >= EXIT_THRESHOLD;

  // B1 (proposal, off by default): alternative exit rules. With the flag absent the result is
  // byte-identical to the count rule; the weighted score / red-alert breakdown is always
  // computed and exposed so the operator can compare reads without flipping anything.
  const exitRule = manual?.experiments?.exit_rule || 'count';
  const weightedHitScore = r1(
    criteria.filter((c) => c.hit).reduce((a, c) => a + (KC_EXIT_WEIGHTS[c.id] ?? 1), 0),
  );
  const redAlertCriteria = criteria.filter((c) => c.hit && KC_DECISIVE.includes(c.id)).map((c) => c.id);
  const redAlert = redAlertCriteria.length > 0;
  let triggered = countTriggered;
  if (exitRule === 'weighted') triggered = weightedHitScore >= EXIT_THRESHOLD;
  else if (exitRule === 'single_hit_override') triggered = countTriggered || redAlert;

  return {
    criteria, hitCount, watchCount, awaitingCount, triggered,
    exitThreshold: EXIT_THRESHOLD, clock,
    experiment: { exitRule, exitBasis: exitRule, countTriggered, weightedHitScore, redAlert, redAlertCriteria },
  };
}
