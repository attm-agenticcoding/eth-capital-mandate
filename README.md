# ETH Capital-Mandate Tracker — Convention Hardening Index

A public, auto-updating dashboard that tracks **one** thesis: that ETH's only durable value channel is becoming the
**capital stock of open on-chain finance** — native, non-freezable, slashable, yield-bearing collateral — **not**
transaction fees.

It scores a **Convention Hardening Index (CHI)** (3 **auto-scored** components, 0–3), scores the **7 thesis kill
criteria** as a structural-falsification scorecard (**≥3 sustained hits → consider exit**), runs a **factory watch**
and a **bear-confirmation panel**, and maps the live CHI to pre-set probability bands.

> Probabilities are a **stated analyst prior, not a model output**. Not investment advice.

---

## How it works

- **`scripts/fetch.mjs`** runs on a 6-hour cron (and on demand). It pulls every AUTO metric from **keyless** public
  APIs, computes the derived series (realized vol, 90-day ETH/BTC correlation, collateral composition, L2→L1 take),
  merges the human-curated **`data/manual.json`**, scores the CHI (`src/lib/chi.mjs`), and writes:
  - `data/latest.json` — the snapshot the site imports
  - `data/history.ndjson` — append-only longitudinal log (**the git commit log is the record**)
  - `data/history.json` — parsed tail used for the component score sparklines
- The site is a **fully static** Vite/React build that imports `data/latest.json` and recomputes the CHI live (so
  editing `manual.json` and rebuilding reflects immediately).
- **GitHub Actions** (`.github/workflows/deploy.yml`) does fetch → commit data → build → deploy to **GitHub Pages**,
  every 6h. No server, no secrets — all sources are keyless.

### Guardrails
- **Never fabricate.** API failure → the previous good value is carried forward and stamped `stale`. A manual field
  left unset renders **"Awaiting"**, never a fake number.
- The scored index is **fully auto** (CHI-1/3/5). CHI-1 keeps a manual *stress-confirm* leg that only matters
  during a ≥50% drawdown. Two signals with **no keyless feed** are kept off the scored index: **CHI-4**
  (institutional collateral) and the **protocol factory** — user-fed milestones shown in the Factory watch that do
  **not** move on their own. (**CHI-2** and **CHI-6** were retired — CHI-2's signal is already in CHI-1's net
  collateral drift; on-chain fixed-term ETH credit barely exists and has no feed.)

---

## The CHI components — exactly what lights each

The scored index is **3 auto components**, each **0 / 0.5 / 1** (max 3). 🟢 = auto-fetched from a keyless API; CHI-1 also has a manual stress-confirm leg (🟢+✍️).

| # | Component | Mode | Lights (= 1) when |
|---|-----------|------|-------------------|
| **CHI-1** | Stress survival | 🟢+✍️ | Through any **≥50% ETH drawdown**, the ETH-system **net** collateral share across Aave/Morpho/Sky falls **≤5pp** AND no top venue delists ETH or cuts max LTV >10pp. **Seeded at 0.5** (the real test is the *next* ≥50% drawdown), but if a ≥50% drawdown is **live** and the net collateral share is already down >5pp, CHI-1 drops to a **0.25 stress-live soft-fail** (below the seed) until the manual no-delist leg resolves. Drawdown is measured from the **true ATH**. Auto-tracks the **net** ETH collateral share — Sky's USDC PSM, pure lenders and same-class loops (wstETH→ETH, sUSDe carries) excluded — plus drawdown; you confirm the no-delist leg only during a crash. |
| **CHI-3** | Slashable ETH bond demand | 🟢 | **ETH restaked** across EigenLayer / Symbiotic / Karak, **ETH-denominated** (price-stripped). Lights at **≥5M ETH**; **≥1M** = partial. **Reverse (Schelling-retired):** collapses **<1M ETH** → if CHI ≤ 0.5, thesis flagged **RETIRED**. *Headline TVL over-reads — treat as upper bound.* |
| **CHI-5** | Volatility / haircut regime | 🟢 | ETH trailing-365d realized vol **<50% for ≥2 consecutive quarters** **AND** ETH's **on-chain max-LTV tier rising** (= haircut compressing) across Aave/Morpho. On-chain LTV is literally a haircut (LTV 86% = 14% haircut), measured against uncorrelated debt (ETH↔ETH loops excluded); the trend accrues from our own log. The haircut leg carries **field-level feed health** (`ethMaxLltvStatus` ok/stale/failed) so a **broken** Morpho feed reads distinctly from genuinely **accruing** data. |

Half credit (**0.5**) is awarded for meaningful-but-incomplete progress (e.g. CHI-3 ≥1M but <5M ETH; CHI-5 with one of the two legs met).

**Retired / off-index.** **CHI-2** (demand-side enforcement) was dropped — its signal is already carried by CHI-1's net ETH-vs-stable collateral drift, and its counterfactual leg ("restrict ETH → lose share") is unattributable. **CHI-6** (duration) was dropped — on-chain fixed-term ETH credit is **<$5M and dormant** (Notional V3 → $0; Pendle is a rate/yield market, not collateral credit) vs ~$13.5B variable-rate ETH collateral, with no keyless maturity feed: a term structure for ETH credit does not exist on-chain yet. **CHI-4** (institutional tabularization — ≥2 regulated venues listing ETH as eligible collateral at haircut ≤40%, **live**) has **no keyless feed**, so it is an **unscored, user-fed milestone** shown in the Factory watch — the highest-confirmation signal, but it does not move the index.

### CHI → probability mapping (computed live)

| CHI total (max 3) | Mandate branch | P($10k by ’30) | P($20k) | Status |
|-----------|----------------|----------------|---------|--------|
| ≥ 2.5 | 53% | 45% | 22% | On track |
| ≥ 1.5 | 42% | 38% | 17% | Hardening |
| else (current) | 32% | 30% | 12% | Stalled / awaiting |
| ≤ 0.5 **and** CHI-3 reverse lit | 25% | — | — | **Schelling RETIRED** |

---

## Kill criteria — structural falsification (the exit rule)

Alongside the confirm-side CHI, the dashboard scores the **7 original thesis kill criteria** as a standalone scorecard
(`src/lib/kill.mjs` → the **Kill criteria** panel). These are **structural falsifiers over a 3–5-year window, not price
stops**. The stated decision rule: **≥3 sustained hits → seriously consider exit.**

Two kinds, which decide what counts as a *hit*:
- **Level** (KC-2/3/5/6) — a threshold breach is itself a structural regression, so it can hit immediately. The
  persistence/flow legs (KC-3 RWA flow, KC-5 sustained issuance, KC-6 growth race) **accrue from the longitudinal log**
  (null → "accruing" until enough history exists), exactly like CHI-5's haircut leg.
- **Deadline** (KC-1/4/7) — the criterion is "within N years" (KC-1 5y, KC-4 3y, KC-7 2y). A condition that is
  *currently* true is **expected this early** and shows **on watch**, not a hit; it becomes a hit only once the horizon
  (anchored at `thesis_clock_start` in `manual.json`) elapses with the condition still true. This stops the scorecard
  over-firing at thesis year ~0, when by construction the market hasn't priced the thesis.

| # | Kill criterion | Kind | Hits when | Source |
|---|----------------|------|-----------|--------|
| **KC-1** | Cash flow + monetary premium 双双落空 | deadline 5y | L1 take-rate ≈0 (<0.5%/yr) **and** ETH/BTC 90d corr >0.85, still true at the 5y horizon | growthepie + CoinGecko |
| **KC-2** | 支付层流失 | level | ETH-aligned (mainnet + ETH-settled rollups) stablecoin share **<35%** (from ~50%) | DefiLlama |
| **KC-3** | 机构结算层旁落 | level | ETH-system RWA share **<50%** (majority defect); new-issuance flow read accrues | DefiLlama |
| **KC-4** | L2 价值回流停滞 | deadline 3y | no top L2 at **Stage 2 + based sequencing** by the 3y horizon (manual leg; L2→L1 reflow as econ context) | L2BEAT + manual |
| **KC-5** | 货币政策失信 | level | NET issuance **>2–3%/yr sustained**, or governance raises the curve (manual). **Mild inflation does NOT count** — it pays for the slashable bond | ultrasound.money |
| **KC-6** | 被 Solana 全面超车 | level | Solana **overtakes** ETH on all-chain TVL share (hit). **Leading leg:** SOL's **DEX-volume share** crossing ETH's → watch, even while TVL still favors ETH (volume leads TVL) | DefiLlama (TVL + DEX volume) |
| **KC-7** | 技术护城河落空 | deadline 2y | no material AI-assisted formal-verification progress by the 2y horizon (manual) | manual watch |

Auto criteria (KC-1/2/3/6 and KC-5's level) recompute live from the snapshot; **KC-4, KC-7 and KC-5's governance leg
are user-fed legs in `manual.json → kill_criteria`**. `thesis_clock_start` sets the deadline horizons. KC-5's framing
is deliberately tuned to the criterion: **mild inflation is neutral** (it funds the security bond), so the bear panel's
issuance read shows net issuance as **%/yr against the 2–3% line**, not a binary "ultrasound / not".

---

## Editing the manual data

The CHI is **fully auto-scored**, so most inputs need no curation. The only human-curated inputs left live in
**`data/manual.json`**: CHI-1's stress-confirm leg, the **unscored** institutional watch (CHI-4), and the protocol
factory watch. Edit it directly in the **GitHub web UI** (pencil → commit); the next cron run (or any push) picks it
up. **Leave anything you can't source as unset/false.**

```jsonc
{
  "_updated": "2026-06-15",                     // bump when you edit

  "chi1_stress": {                              // CHI-1 manual leg — only matters during a ≥50% drawdown
    "episode_through_50dd": false,              // set true once a ≥50% drawdown completes
    "share_delta_pp": null,                     // ETH-system collateral share change in pp (negative = fell)
    "no_delist_or_ltv_cut": null                // true if no top venue delisted ETH / cut max LTV >10pp
  },

  "chi4_institutional": {                       // UNSCORED watch — add one object per regulated venue
    "venues": [
      { "name": "", "type": "PB|CCP|margin", "asset": "spot|staked",
        "haircut_pct": null, "live": false, "source": "" }
    ]
  },

  "factory_protocol": {                         // protocol value-routing watch
    "items": [
      { "name": "blob-fee-floor|mev-burn|native-rollup-eth-bond", "eip": "",
        "status": "idea|draft|cfi|scheduled|live", "fork": "", "source": "" }
    ]
  },
  "factory_codification_note": "",

  "kill_criteria": {                            // manual legs for the kill scorecard (no keyless feed)
    "thesis_clock_start": "2025-01-01",         // anchors the DEADLINE horizons (KC-1 5y, KC-4 3y, KC-7 2y)
    "kc4_l2_reflow":         { "top_l2_stage2_and_based": null, "source": "" },  // true once a top L2 hits Stage 2 + based seq
    "kc5_monetary":          { "issuance_curve_raised": false,  "source": "" },  // true if governance repeatedly raises issuance
    "kc7_formal_verification": { "material_progress": null,     "source": "" }   // true on material formal-verification progress
  }
}
```

A field left unset renders **"Awaiting"** in the UI. CHI-4's watch lights at ≥2 live venues (haircut ≤40%) but
**never moves the scored index**. Always attach a `source` URL; never invent values.

### Experiments (propose-only, off by default)

Three semantic changes are implemented behind opt-in flags that default to **absent → off**, so the scored
index reads exactly as today until you flip one. See **`docs/proposals.md`** for the full write-ups and the
effect on current data. Add to `manual.json` to enable:

```jsonc
{
  "experiments": {
    "exit_rule": "count",              // B1: "count" (default) | "weighted" | "single_hit_override"
    "kc2_kc3_strict_alignment": false, // B2: score KC-2/KC-3 against the STRICT ETH-aligned set
    "demote_chi5": false               // B3: drop CHI-5 from the scored index (→ unscored watch, max 2)
  }
}
```

---

## Local development

```bash
npm install
npm run fetch     # pull live data → data/latest.json (+ history)
npm run dev       # local dev server
npm run build     # production build → dist/
npm run preview   # serve the production build
```

## Deployment

GitHub Actions builds and deploys to **GitHub Pages** on every push to `main`, on manual dispatch, and every 6 hours.
The data refresh is committed back to the repo (`[skip ci]` so it doesn't loop), then the site is rebuilt with the
fresh snapshot and deployed. To enable: push to GitHub, ensure **Settings → Pages → Source = GitHub Actions** and
**Settings → Actions → Workflow permissions = Read and write**.

## Data sources (all keyless)

CoinGecko (price / vol / correlation / ATH) · DefiLlama (Aave/Sky collateral, stablecoins, chains, RWA, restaking, DEX volume) · Morpho Blue API (per-market net collateral + ETH on-chain max-LTV) ·
ultrasound.money (supply, staking, issuance/burn) · growthepie.xyz (L1+blob fees, L2→L1 economics) · L2BEAT (L2 TVL).

---

*The dashboard tests a thesis; it does not endorse it. Not investment advice.*
