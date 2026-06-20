# Maintenance & hardening pass — summary

Branch `harden/maintenance-pass`. Verification harness: `npm run selfcheck && npm run build`
(39 assertions, all green). Each task is its own tested commit. No fabricated data; no hand-edits
to `data/*.json` (only `test/fixtures/`). Pure scorers stay the single source of truth for the UI
and `scripts/fetch.mjs`.

## Harness (Step 1)
- `test/fixtures/current.json` — frozen characterization snapshot.
- `scripts/selfcheck.mjs` — `node:test` baseline + per-task behavior fixtures (39 tests).
- `package.json` — `"selfcheck"` script.

## Part A — deterministic fixes (default scored output changes where noted)

| # | Change | Live-data impact |
|---|--------|------------------|
| **A1** | CHI-5 haircut leg distinguishes a **broken feed** from **accruing**. New field-level `collateral.ethMaxLltvStatus` (`ok`/`stale`/`failed`); a failed feed reads "feed unavailable / broken", stale carries forward, "accruing" is reserved for ok + <2 points. | None to score (CHI-5 still 0). Feed currently `ok` (86%). Broken state now visibly distinct. |
| **A2** | CHI-1 **stress-live** branch: in a ≥50% drawdown with share Δ ≤−5pp and the manual episode unresolved, score **0.25** (soft-fail below the seed) instead of holding 0.5. Index total now rounds to 0.01 (a 0.25 made quarter-steps real). | **CHI-1 0.5 → 0.25, CHI total 1.0 → 0.75.** Probability band unchanged (Stalled / awaiting). Baseline updated. |
| **A3** | `elevated` pre-cliff warning for deadline criteria (condition met past ≥60% of horizon). Applied to KC-1/4/7. | None now (clock ~1.5y → KC-1 plain watch). Fires as the clock advances; never a hit. |
| **A4** | Drawdown that feeds CHI-1 now uses the **true ATH** (CoinGecko `ath`), not the rolling-365d max. Rolling value kept as `drawdownFrom365dHighPct` (display). New pure `src/lib/market.mjs`. | CHI-1-facing drawdown ≈ **65.5%** (true ATH) vs ≈64.7% rolling. |
| **A5** | KC-6 gains a **leading DEX-volume-share leg** (DefiLlama `/overview/dexs`, keyless). New `chains.ethDexVolSharePct` / `solDexVolSharePct`. Escalates to watch when SOL volume share crosses ETH while TVL still favors ETH. | **KC-6 intact → watch.** SOL DEX volume ≈23% vs ETH ≈17% while TVL share is ETH 53% vs SOL 6.5%. hitCount unchanged (0). |
| **A6** | KC-2/KC-3 alignment sensitivity exposed: **broad vs strict** ETH-aligned shares + a widening-gap divergence note. New `ETH_ALIGNED_CHAINS_STRICT`. | Display only. Stablecoins 55.2% broad / 53.9% strict (Δ1.3pp); RWA 62.1% / 60.9%. KC-2/KC-3 scored status unchanged. |
| **A7** | KC-3 surfaces a **new-issuance flow** read (Δ ETH RWA ÷ Δ total RWA), labeled "accruing" until the log has ≥2 points. Absolute RWA value persisted to history. | Detail only; default stock-share hit trigger unchanged. |

**Net default-scored impact:** CHI total **1.0 → 0.75** (A2); KC-6 **intact → watch** (A5); hitCount
unchanged at **0**. Everything else is display/measurement.

## Part B — propose-only (off by default, no change to scored output)

Implemented behind `manual.json → experiments.*` (absent → off) and written up in `docs/proposals.md`.

- **B1 — exit-rule weighting.** `experiments.exit_rule`: `count` (default) | `weighted` (KC-1=2,
  KC-3=1.5) | `single_hit_override` (KC-1/KC-3 hit → red alert). On current data all agree (0 hits);
  the breakdown is always exposed via `experiment.*`. **Recommendation: `single_hit_override`.**
- **B2 — strict scored set.** `experiments.kc2_kc3_strict_alignment`: route KC-2/KC-3 onto the strict
  aligned share. Today KC-2 55.2%→53.9% (both intact). **Recommendation: strict for KC-2 only** (KC-3's
  mainnet basis is already narrower; the A7 flow is its real sharpening).
- **B3 — demote CHI-5.** `experiments.demote_chi5`: drop CHI-5 to an unscored watch (max 3→2);
  `mapProbabilities` rescales bands. Total 0.75 either way today. **Recommendation: keep for now,
  revisit once the A1 haircut trend has accrued.**

### ⚠ Awaiting operator decisions
1. **B1 / B2 / B3** — flip any flag on? (defaults leave the index exactly as today).
2. **`thesis_clock_start = 2025-01-01`** — please confirm this is the real observation/position start.
   It anchors every deadline horizon (KC-1 5y, KC-4 3y, KC-7 2y) and the A3 elevated thresholds; a
   one-year error shifts KC-1's hit date by a year. **Not changed here.**
