# ETH Capital-Mandate Tracker — Maintenance & Hardening Pass

You are working in the `eth-capital-mandate` repo (static Vite/React dashboard that scores an ETH
thesis from keyless public APIs). Your job is to fix a set of correctness and methodology issues
found in a review. Work **autonomously and iteratively**: build a verification harness first, then
land each task as its own tested, committed change. Do not ask for confirmation between tasks —
loop until the Definition of Done is met.

---

## Prime directives (never violate)

1. **Never fabricate data.** A missing value renders as a state ("awaiting" / "broken" / "accruing"),
   never a fake number. This is the project's core guarantee — preserve it.
2. **Distinguish "feed broken" from "data accruing."** A null because an upstream fetch *failed* is a
   different state from a null because there is *not yet enough history* to compute a delta. They must
   render differently and must never look the same. (This is the bug class behind several tasks.)
3. **Scorers stay pure.** `src/lib/chi.mjs` and `src/lib/kill.mjs` are pure functions shared by the UI
   and `scripts/fetch.mjs`. No Node/browser APIs in them beyond `Date.now`. Keep one source of truth.
4. **You may edit code and test fixtures only.** Do NOT hand-edit `data/latest.json`,
   `data/history.*`, or `data/manual.json` values. Those are produced by `npm run fetch` or owned by
   the human operator. You may regenerate `latest.json` by running `npm run fetch`, and you may create
   fixtures under `test/fixtures/`.
5. **Part B is propose-only.** Tasks in Part B change what the scored index *means* (exit-rule
   semantics, what counts as Ethereum-aligned, whether a component is dropped). Do NOT change default
   scored output for these. Implement them behind an off-by-default flag and/or write a written
   proposal — the human decides.
6. **Prefer zero new dependencies.** For tests use Node's built-in `node:test` + `node:assert`.

---

## How to work — the loop

**Step 0 — Orient.** Read: `README.md`, `src/lib/chi.mjs`, `src/lib/kill.mjs`, `scripts/fetch.mjs`,
`data/manual.json`, and the component files in `src/components/` (esp. `ChiGrid.jsx`, `KillPanel.jsx`,
`BearPanel.jsx`, `FactoryWatch.jsx`, `charts.jsx`). Confirm you understand the `auto`/`manual` snapshot
shape and the `level` vs `deadline` criterion taxonomy before changing anything.

**Step 1 — Build the harness (do this before any fix).**
- Create `test/fixtures/` and copy the **current** `data/latest.json` into `test/fixtures/current.json`.
  This is the characterization fixture: it locks in today's known state so you catch regressions.
- Create `scripts/selfcheck.mjs` (ESM, uses `node:test`/`node:assert`) that imports `computeCHI` and
  `computeKill` and asserts, against `current.json`, the **current known-good baseline**:
  - `computeCHI(current).total === 1.0`
  - CHI-1 score `0.5` (seed), CHI-3 score `0.5`, CHI-5 score `0`
  - `computeKill(current).hitCount === 0`
  - KC-1 status `watch`, KC-2/KC-3/KC-5/KC-6 `intact`, KC-4/KC-7 `awaiting`
- Add `"selfcheck": "node --test scripts/selfcheck.mjs"` to `package.json` scripts.
- **The loop command after every change is:** `npm run selfcheck && npm run build`
  For feed-touching tasks also run `npm run fetch` and inspect the affected fields in `data/latest.json`.

**Step 2 — Per task:** write the new assertion(s) describing the desired behavior (they should fail) →
implement the change → run the loop command → iterate until green → **commit with a clear message**
(one commit per task, e.g. `fix(chi5): surface broken max-LTV feed distinctly from accruing`). When a
fix intentionally changes the baseline (e.g. A1 changes the drawdown number, A2 lowers live CHI), UPDATE
the characterization assertions in the same commit and state the intended new value in the commit body.

**If blocked by a live API** (an endpoint is down or schema-changed in your environment): do NOT stall.
Make the code fail *gracefully* (carry-forward + explicit broken-state), verify that behavior via a
fixture, note it in the commit body, and move on.

---

## Repo map (where things live)

| Concern | File |
|---|---|
| Data pipeline (all fetchers, scoring write-out) | `scripts/fetch.mjs` |
| Kill-criteria scorers (KC-1..7) | `src/lib/kill.mjs` |
| CHI scorers (CHI-1/3/5) + probability map | `src/lib/chi.mjs` |
| Snapshot import / formatting | `src/lib/data.js`, `src/lib/format.js` |
| UI panels | `src/components/*.jsx` |
| Human-curated legs | `data/manual.json` |
| Live snapshot the site imports | `data/latest.json` |
| Append-only log + parsed tail | `data/history.ndjson`, `data/history.json` |

---

## Known current state (ground truth — use for fixtures)

From the live `latest.json` at review time:
- `fees.takeRatePctPerYr = 0.087` (L1+blob revenue ÷ on-chain value), `correlation.now = 0.90`
- `stablecoins.ethSharePct = 50.8` (mainnet), `ethAlignedSharePct = 55.2` (broad set)
- `rwa.ethSharePct = 54.5`
- `supply.net30dEth = 82895`, `totalSupplyEth = 121,794,229` → net issuance ≈ **0.83%/yr**
- `chains.ethSharePct = 53.2`, `solanaSharePct = 6.5`
- `collateral.combinedEthSharePct = 58`, `combinedEthShareDeltaPp = -6.2`, `eth.drawdownFromPeakPct = 64.8`
- `restaking.restakedEth = 2,962,665` (2.96M)
- `vol.d365Pct = 68`, `vol.quartersUnder50 = 0`
- **`collateral.ethMaxLltvPct = null`, `ethMaxLltvDeltaPp = null`** ← the broken feed
- `eth.price = 1702.05`, `eth.ath = 4946.05`

---

# PART A — deterministic fixes (do all, loop each)

> The three highest-priority are **A1 (broken feed), A2 (live stress), A5 (volume leg)**. Do them first.

### A1 — CHI-5's on-chain haircut leg is silently dead
**Problem.** `collateral.ethMaxLltvPct` / `ethMaxLltvDeltaPp` are `null` in production, so CHI-5 runs on
one leg and the null renders as "accruing" — indistinguishable from a real broken feed.
**Files.** `scripts/fetch.mjs` (`morphoNetCollateral`, `getCollateral`), `src/lib/chi.mjs` (`chi5`),
`src/components/ChiGrid.jsx`.
**Change.**
- Run `npm run fetch` and diagnose why max-LTV is null. If the Morpho Blue query/schema or the field
  mapping is broken, fix it so the value populates. Verify against the live source.
- Add **field-level feed health** to the snapshot (e.g. `collateral.ethMaxLltvStatus = 'ok'|'stale'|'failed'`),
  derived from whether the sub-fetch succeeded — not just the coarse per-source `record()`.
- In `chi5`, when the haircut leg is null **because the feed failed**, the detail must say
  **"feed unavailable / broken"** (and ideally stamp the component), NOT "accruing". "Accruing" is
  reserved for the genuine case: feed OK but `<2` history points to compute the delta.
**Acceptance.**
- After fetch (or via a fixture with a populated value), `ethMaxLltvPct` is non-null and CHI-5's haircut
  leg evaluates against it.
- Fixture A1a (`ethMaxLltvStatus='failed'`) → CHI-5 detail contains "broken"/"unavailable", not "accruing".
- Fixture A1b (`ethMaxLltvStatus='ok'`, single history point) → detail says "accruing".

### A2 — CHI-1 is locked mid-stress-test
**Problem.** ETH is in a **−64.8% drawdown** (the auto drawdown leg is already > 50%) and the auto
net-collateral delta is **−6.2pp** (worse than the ≤5pp light condition), yet CHI-1 sits at the neutral
seed `0.5` with only a caution string, because the manual `episode_through_50dd` leg is unset. The
seed-0.5 logic assumes the drawdown is a *future* event; it is happening *now* and the auto leg already
has a (bad) signal.
**Files.** `src/lib/chi.mjs` (`chi1`), `src/components/ChiGrid.jsx`.
**Change.**
- Add a **"stress-live"** branch: when `drawdownFromPeakPct >= 50` AND the manual episode is not yet
  resolved, score from the auto delta instead of holding the neutral seed:
  - auto delta `<= -5pp` → **soft-fail sub-score strictly below 0.5** (e.g. `0.25`), status text must
    say the stress test is **ACTIVE** and the manual no-delist/LTV check is still pending.
  - auto delta `> -5pp` → hold `0.5` ("holding under stress").
- The manual leg stays **human-owned** (do not set it yourself). Once the operator records a completed
  episode, the existing resolved logic (→ `1` or `0`) takes over and overrides the live branch.
- **Invariant:** a live soft-fail must score *below* the neutral seed and must never read as neutral.
**Acceptance.**
- Fixture A2 (`dd=64.8`, `combinedEthShareDeltaPp=-6.2`, manual unset) → CHI-1 `0.25`, detail says
  "stress test active" + "pending no-delist confirmation".
- This intentionally lowers live `computeCHI(current).total` from `1.0` to `0.75` — update the
  characterization baseline accordingly and note it in the commit body.

### A3 — KC-1 gives no progressive warning before the 5-year cliff
**Problem.** Both KC-1 legs are already lit (take-rate `0.087 < 0.5`, corr `0.90 > 0.85`); it shows
`watch` purely because the 5y deadline (`thesis_clock_start` 2025-01-01) hasn't elapsed. It will jump
straight from `watch` to `hit` in 2030 with no intermediate signal.
**Files.** `src/lib/kill.mjs` (`kc1`; consider a reusable helper for deadline criteria),
`src/components/KillPanel.jsx`.
**Change.** Add an elevated state for deadline criteria whose condition is fully met and whose clock has
passed **≥60% of the horizon** (3y of 5y for KC-1). Surface it as `watch-elevated` (or a boolean
`elevated` flag on the criterion) so the UI can flag it visually. Apply the same helper to KC-4 (3y) and
KC-7 (2y) for consistency.
**Acceptance.**
- Fixture A3a (clock 3.2y ago, both legs lit) → KC-1 `watch-elevated`/`elevated:true`.
- Fixture A3b (clock 1y ago, both legs lit) → KC-1 plain `watch`.
- `hit` semantics and the `hitCount` ≥3 rule are unchanged (`watch-elevated` is not a hit).

### A4 — Drawdown uses a rolling-window max, not the true ATH
**Problem.** `getMarket` computes `drawdownFromPeakPct` from `max(ethPx)` over the **365-day** window.
Once the real ATH (`eth.ath`, currently `4946.05`) slides out of that window, the drawdown will shrink
abruptly even with a flat price — and CHI-1's "≥50% drawdown" trigger depends on this number.
**Files.** `scripts/fetch.mjs` (`getMarket`).
**Change.** Compute the CHI-1-facing `drawdownFromPeakPct` from CoinGecko's all-time `ath` field
(`(1 - current_price/ath) * 100`). You may keep the rolling-window value as a separate display field,
but the value that feeds CHI-1 must be the true-ATH drawdown. Do not hardcode any ATH.
**Acceptance.** With `price=1702.05`, `ath=4946.05` → drawdown ≈ `65.6%`. Update the characterization
baseline's expected drawdown and note it.

### A5 — KC-6 is blind to how Solana actually takes share
**Problem.** KC-6 and the CHI series lean on DefiLlama **TVL**, which structurally under-reads Solana
(whose strength shows in throughput/volume, not locked TVL). If Solana is winning, it appears in
**volume/flow first**; TVL share is lagging. Right now *all six* competitor signals are stock metrics —
the most leading "losing the market" signal is the most sluggish.
**Files.** `scripts/fetch.mjs` (new fetcher, e.g. `getDexVolume`), `src/lib/kill.mjs` (`kc6`),
`src/components/BearPanel.jsx`.
**Change.** Add a keyless **DEX-volume-share** leg (e.g. DefiLlama `/overview/dexs` by chain; pick a
stable keyless endpoint and verify it). Populate `chains.ethDexVolSharePct` / `solDexVolSharePct`. Give
KC-6 a second, **volume-based** leg so it can escalate to `watch` when volume share shifts toward Solana
**even while TVL share still favors ETH**.
**Acceptance.** Fixture A5 (TVL share ETH≫SOL, but SOL DEX-volume share rising and crossing ETH) →
KC-6 `watch`. Live fetch populates the new fields; if the endpoint is unavailable, fail gracefully
(broken-state, not fabricated) and verify via fixture.

### A6 — KC-2/KC-3 hide the sensitivity to the "Ethereum-aligned" definition
**Problem.** `ETH_ALIGNED_CHAINS` includes settle-questionable chains (e.g. Polygon PoS counted "by
convention"). The headline share (55.2% broad / 50.8% mainnet vs a 35% kill line) depends heavily on
that list, but the UI shows a single number.
**Files.** `scripts/fetch.mjs` (`getStablecoins`; RWA equivalent in `getRwa`), `src/lib/kill.mjs`
(display only — see note), relevant components.
**Change (display + signal only — scoring set is a Part B decision):**
- Compute **two** aggregates: `ethAlignedSharePctBroad` (current list) and `ethAlignedSharePctStrict`
  (mainnet + only rollups that genuinely settle to and post DA on Ethereum; exclude Polygon PoS and any
  sovereign/validium-by-default chain). Do the same for RWA where feasible.
- Display both, and add a **divergence signal** that flags when (broad − strict) widens over time
  (= ETH's share is increasingly carried by the weakest-alignment chains).
- **Do not** change which set KC-2/KC-3 *score* against in this task (that's B2).
**Acceptance.** Snapshot exposes both strict and broad shares; UI renders both; a widening broad−strict
gap surfaces a visible divergence note. KC-2/KC-3 scored status is unchanged vs baseline.

### A7 — KC-3 measures stock, but the thesis cares about flow
**Problem.** KC-3's level leg is RWA **stock** share (<50% to hit). Stock has huge inertia (existing
BUIDL etc. keeps ETH ≥50% even if *every new* product picks another chain), so the level leg will hit
years late. The existing flow leg measures ETH's *own* share delta, which is not the same as "share of
**new** RWA value added."
**Files.** `scripts/fetch.mjs` (`getRwa` — log absolute RWA value per chain), `src/lib/kill.mjs` (`kc3`),
`data/history` write-out.
**Change (measurement only; KC-3 hit-logic change is B-adjacent — keep default hit logic as-is):**
- Persist absolute RWA value per chain over time so a true **new-issuance flow share** (Δ ETH RWA value
  ÷ Δ total RWA value, over the logged window) can be computed once history accrues.
- Surface this flow-share read in KC-3's detail/value text as the *leading* indicator, clearly labeled
  "accruing" until enough history exists. Keep the stock-share level as the (lagging) hit trigger for now.
**Acceptance.** Snapshot/history carries per-chain absolute RWA value; KC-3 detail shows a labeled
flow-share read that accrues from the log; default `status` logic unchanged.

---

# PART B — propose only; do NOT change default scored output

For each, implement behind an **off-by-default** flag (e.g. `manual.json → experiments.*`, defaulting
false/absent) AND write a short proposal to `docs/proposals.md` (create it) covering: the change, the
exact behavior delta on today's data, and the risk. The human will decide whether to flip it on.

### B1 — Equal-weight exit rule loses "which criterion"
The `EXIT_THRESHOLD = 3` count treats all KCs as 1:1, but KC-1 (cash flow + premium both fail) is the
thesis's core proposition — its single failure is more decisive than, say, KC-6. **Propose** either (a)
per-criterion weights, or (b) a single-hit override so a KC-1 (and arguably KC-3) hit raises an
independent red alert regardless of the count. Show how each option would read on current data.

### B2 — Should the scored share use the *strict* alignment set?
Building on A6: decide whether KC-2/KC-3 should score against the **strict** Ethereum-aligned set rather
than the broad one. This retightens the thesis test, so it's a semantic choice, not a bugfix. Propose
the strict-set definition precisely and show the resulting KC-2/KC-3 status under strict vs broad today.

### B3 — Is CHI-5 (and the index denominator) still earning its place?
CHI-5 is structurally pinned near 0 (RV365 68% ≫ 50%, and the haircut leg only just being fixed in A1),
so the live index is effectively two-component (total 1.0, soon 0.75 after A2). The project already
retired CHI-2/CHI-6 on exactly this "nothing faithful to score / no signal" logic. **Propose** whether
CHI-5 should be (a) kept, (b) demoted to an unscored watch like CHI-4, or (c) re-specified. Separately,
**flag for human confirmation** that `thesis_clock_start = 2025-01-01` corresponds to a real
observation/position start date (it anchors every deadline criterion; a one-year error shifts KC-1's hit
date by a year). Do not change it yourself.

---

## Definition of done

- [ ] `scripts/selfcheck.mjs` exists; `npm run selfcheck && npm run build` passes.
- [ ] `test/fixtures/current.json` characterization fixture in place; baseline assertions pass (with the
      A2/A4-updated values, documented in commits).
- [ ] Part A: A1–A7 each landed as an individual, tested commit. Broken feeds are now visibly distinct
      from accruing data. CHI-1 reflects the live stress test. KC-6 has a volume leg. Strict+broad
      shares are both shown.
- [ ] Part B: B1–B3 implemented behind off-by-default flags with no change to default scored output, and
      written up in `docs/proposals.md`.
- [ ] No fabricated values anywhere; no hand-edits to `data/*.json` except `test/fixtures/`.
- [ ] Pure scorers remain pure and remain the single source of truth for UI + fetch.
- [ ] A short `CHANGES.md` (or PR description) summarizing each task, the live-data impact, and the open
      Part B decisions awaiting the operator.
