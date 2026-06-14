# ETH Capital-Mandate Tracker — Convention Hardening Index

A public, auto-updating dashboard that tracks **one** thesis: that ETH's only durable value channel is becoming the
**capital stock of open on-chain finance** — native, non-freezable, slashable, yield-bearing collateral — **not**
transaction fees.

It scores a **Convention Hardening Index (CHI)** (6 components, 0–6), runs a **factory watch** and a
**bear-confirmation panel**, and maps the live CHI to pre-set probability bands.

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
- The thesis-critical components (**CHI-3, CHI-4**, protocol factory) are **MANUAL by necessity** — no API exists.
  The UI badges these clearly; they do **not** move on their own.

---

## The 6 CHI components — exactly what lights each

Each scores **0 / 0.5 / 1** (max 6). 🟢 = auto-fetched, ✍️ = you curate it in `data/manual.json`.

| # | Component | Mode | Lights (= 1) when |
|---|-----------|------|-------------------|
| **CHI-1** | Stress survival | 🟢+✍️ | Through any **≥50% ETH drawdown**, ETH-system collateral share across Aave/Morpho/Sky falls **≤5pp** AND no top venue delists ETH or cuts max LTV >10pp. **Seeded at 0.5** (2022 passed eligibility, but stable/T-bill collateral wasn't at scale — the real test is the *next* ≥50% drawdown). Auto-tracks share + drawdown; you confirm the no-delist leg. |
| **CHI-2** | Demand-side enforcement | ✍️ | An ETH-restricting venue demonstrably loses TVL share, OR ETH keeps the top LTV tier in venues that **also** list tokenized-treasury collateral. |
| **CHI-3** | Mandatory slashable ETH bond | ✍️ | **≥3 LIVE** systems across **≥2 categories** (preconf / based-sequencing / solver-intent / agent-escrow / cross-chain insurance) **require** an ETH-denominated slashable bond, **≥5M ETH** bound aggregate. **Reverse signal (−0.5)**: a top-2 standard in any category adopts multi-asset/stablecoin bonding instead — and if CHI ≤ 1.5 this flags the Schelling thesis **RETIRED**. |
| **CHI-4** | Institutional tabularization | ✍️ | **≥2 regulated venues** (prime broker, CCP/clearinghouse, or regulated margin program) list ETH on a collateral eligibility schedule at **haircut ≤40%**, **LIVE** (not announced). |
| **CHI-5** | Volatility / haircut regime | 🟢+✍️ | ETH trailing-365d realized vol **<50% for ≥2 consecutive quarters** (auto) **AND** regulated-venue haircut quotes trending down (manual). |
| **CHI-6** | Duration | ✍️ | Fixed-term (**≥90-day**) borrowing against ETH collateral **≥10%** of total ETH-collateral debt (Pendle / Morpho fixed-term / Term / Notional). |

Half credit (**0.5**) is awarded for meaningful-but-incomplete progress (e.g. CHI-4 with exactly one live venue; CHI-3 with ≥1 live mandatory system but below the full bar).

### CHI → probability mapping (computed live)

| CHI total | Mandate branch | P($10k by ’30) | P($20k) | Status |
|-----------|----------------|----------------|---------|--------|
| ≥ 5.0 | 53% | 45% | 22% | On track |
| ≥ 3.5 | 42% | 38% | 17% | Hardening |
| else (current) | 32% | 30% | 12% | Stalled / awaiting |
| ≤ 1.5 **and** CHI-3 reverse lit | 25% | — | — | **Schelling RETIRED** |

---

## Editing the manual data

All human-curated inputs live in **`data/manual.json`**. Edit it directly in the **GitHub web UI**
(pencil icon → commit). The next cron run (or any push) picks it up. **Leave anything you can't source as unset/false.**

```jsonc
{
  "_updated": "2026-06-14",                  // bump when you edit

  "chi1_stress": {                            // CHI-1 manual leg + stress-episode record
    "episode_through_50dd": false,            // set true once a ≥50% drawdown completes
    "share_delta_pp": null,                   // ETH-system collateral share change in pp (negative = fell)
    "no_delist_or_ltv_cut": null              // true if no top venue delisted ETH / cut max LTV >10pp
  },

  "chi2_demand_enforcement": { "lit": false, "note": "", "source": "" },

  "chi3_mandatory_bond": {                    // add one object per LIVE system
    "systems": [
      { "name": "", "category": "preconf|sequencing|solver|agent-escrow|insurance",
        "eth_bound": 0, "mandatory": false, "live": false, "source": "" }
    ],
    "reverse_signal": false                   // true if a top-2 standard went multi-asset/stablecoin bonding
  },

  "chi4_institutional": {                     // add one object per regulated venue
    "venues": [
      { "name": "", "type": "PB|CCP|margin", "asset": "spot|staked",
        "haircut_pct": null, "live": false, "source": "" }
    ]
  },

  "chi5_haircut_trend": { "compressing": null, "note": "", "source": "" },  // true if haircuts trending down

  "chi6_term_share_pct": null,                // % of ETH-collateral debt in fixed-term (≥90d) borrowing

  "factory_protocol": {                       // protocol value-routing watch
    "items": [
      { "name": "blob-fee-floor|mev-burn|native-rollup-eth-bond", "eip": "",
        "status": "idea|draft|cfi|scheduled|live", "fork": "", "source": "" }
    ]
  },
  "factory_codification_note": ""
}
```

**What flips each manual component:** see the table above — the JSON keys map 1:1. A component shows **"Awaiting"**
in the UI until its evidence is filled in. Always attach a `source` URL; never invent values.

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

CoinGecko (price / vol / correlation) · DefiLlama (collateral composition, stablecoins, chains, RWA) ·
ultrasound.money (supply, staking, issuance/burn) · growthepie.xyz (L1+blob fees, L2→L1 economics) · L2BEAT (L2 TVL).

---

*The dashboard tests a thesis; it does not endorse it. Not investment advice.*
