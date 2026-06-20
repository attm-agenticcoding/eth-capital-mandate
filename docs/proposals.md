# Part B — proposals (operator decides)

These three changes alter what the scored index *means* (exit-rule semantics, what counts as
Ethereum-aligned, whether a component is dropped). Per the maintenance brief they are
**propose-only**: each is implemented behind an **off-by-default flag** and changes **nothing**
in the default scored output. The flags live under `manual.json → experiments.*` and default to
**absent → off** — the code reads `manual.experiments?.<flag>` and falls back to today's
behavior, so the operator opts in by adding the key (the harness never hand-edits `manual.json`).

To enable one, add to `data/manual.json`:

```jsonc
{
  "experiments": {
    "exit_rule": "count",            // B1: "count" (default) | "weighted" | "single_hit_override"
    "kc2_kc3_strict_alignment": false, // B2: score KC-2/KC-3 against the STRICT aligned set
    "demote_chi5": false             // B3: drop CHI-5 from the scored index (→ unscored watch)
  }
}
```

All three currently read **no change** on live data because **0 kill criteria are hit** and the
shares sit clear of their lines — but each changes how the index would behave as conditions move.
Numbers below are from the live snapshot at writing (ETH ≈ $1.71k, drawdown ≈ −65% true-ATH).

---

## B1 — the equal-weight exit rule loses *which* criterion

**Problem.** `EXIT_THRESHOLD = 3` counts every KC 1:1. But **KC-1** (cash flow ≈ 0 **and** no
monetary premium) is the thesis's *core proposition* — its failure is more decisive than, say,
KC-6 (Solana benchmark). KC-3 (institutional settlement defects) is arguably second. A flat count
can sit at "2/3 — no exit" while the two criteria that actually falsify the thesis are the ones lit.

**Proposal — two options, both behind `experiments.exit_rule`:**

- **(a) `"weighted"`** — per-criterion weights, exit when the weighted hit-score ≥ 3:

  | KC | weight | rationale |
  |----|--------|-----------|
  | KC-1 | **2.0** | core proposition (cash flow + premium both fail) |
  | KC-3 | **1.5** | institutional settlement layer defects |
  | KC-2, KC-4, KC-5, KC-6, KC-7 | 1.0 | each a single structural signal |

- **(b) `"single_hit_override"`** — keep the count rule, but a **KC-1 or KC-3 hit raises an
  independent red alert** regardless of the count (`triggered = count≥3 OR redAlert`).

**How each reads on current data (0 hits):** all three modes → **not triggered** (identical today).

**Worked example — the case that separates them.** Suppose KC-1 and KC-3 are both hit, nothing else:

| mode | reads as | exit? |
|------|----------|-------|
| `count` (default) | 2 / 3 hits | **no** |
| `weighted` | 2.0 + 1.5 = **3.5** ≥ 3 | **yes** |
| `single_hit_override` | count 2/3, but KC-1 hit | **yes (red alert)** |

So the two core falsifiers firing together would **not** trip the default rule but **would** trip
either proposal. `computeKill` already exposes the breakdown (`experiment.weightedHitScore`,
`experiment.redAlert`, `experiment.redAlertCriteria`) so the operator can see both reads side by side.

**Risk.** Weights/overrides encode a judgment about which criteria matter most; if mis-set they make
the scorecard trigger-happy (override) or hide a broad-but-shallow failure (weighting concentrates on
KC-1/3). Recommendation: **`single_hit_override`** — it preserves the count rule and only *adds* a
decisive-criterion alert, the smallest semantic change.

---

## B2 — should KC-2/KC-3 *score* against the strict alignment set?

**Background (A6).** The headline ETH-aligned share leans on settle-questionable chains. A6 now
exposes both a **broad** set (current `ETH_ALIGNED_CHAINS`) and a **strict** set (mainnet + rollups
that genuinely settle to **and** post DA on Ethereum). A6 only *displays* both; **B2** is the
semantic choice of which set the kill criteria *score*.

**Strict-set definition (precise).** `ETH_ALIGNED_CHAINS_STRICT` = `ETH_ALIGNED_CHAINS` minus:
- **Polygon PoS** — a sidechain / commit-chain, not a rollup settling to Ethereum;
- **Mantle** (EigenDA), **Manta** (Celestia), **Metis** (off-chain DAC), **Fraxtal** (own DA layer)
  — they do **not** post data availability to Ethereum by default (validium/alt-DA).

Everything that posts DA to Ethereum (Base, Arbitrum, OP, zkSync Era, Scroll, Linea, Starknet,
Blast, Mode, Zora, Taiko, Ink, Soneium, Unichain, World Chain, Abstract, Polygon zkEVM) stays.

**Behind `experiments.kc2_kc3_strict_alignment`:** when on, **KC-2** scores
`stablecoins.ethAlignedSharePctStrict` and **KC-3** scores `rwa.ethAlignedSharePctStrict` (instead
of mainnet-only stock).

**Status under strict vs broad today:**

| criterion | basis | share | line | status |
|-----------|-------|-------|------|--------|
| KC-2 | broad (default) | **55.2%** | <35 hit / <40 watch | intact |
| KC-2 | strict | **53.9%** | " | **intact** (−1.3pp) |
| KC-3 | mainnet stock (default) | **54.7%** | <50 hit | intact |
| KC-3 | strict-aligned | **60.9%** | <50 hit | **intact** (basis change: mainnet→aligned reads *higher*) |

**Note on KC-3.** Its default scored basis is **mainnet-only** RWA stock, which is *already* narrower
than the strict-aligned chain set — so moving KC-3 onto the aligned set would read **higher** (60.9%),
not lower. The genuine sharpening for KC-3 is the **A7 new-issuance flow** read, not the chain set.
The flag is wired for KC-3 for completeness, but the recommendation is to apply strict scoring to
**KC-2 only**.

**Risk.** Strict scoring retightens the test (good: fewer weak-alignment chains propping the share)
but couples the kill line to a curated DA-classification list that must be maintained as chains change
their DA. Recommendation: adopt **strict for KC-2**; leave KC-3 on mainnet stock + watch the A7 flow.

---

## B3 — is CHI-5 (and the index denominator) still earning its place?

**Problem.** CHI-5 (vol/haircut regime) is structurally pinned near 0: RV365 ≈ 68% ≫ 50%, and the
haircut leg only just became measurable (A1). The live index is effectively two-component
(CHI-1 + CHI-3). The project already retired CHI-2 and CHI-6 on exactly this "nothing faithful to
score / no signal" logic.

**Proposal — `experiments.demote_chi5`, three options:**

- **(a) keep** (default) — 3-component index, max 3, CHI-5 scored.
- **(b) demote** (`demote_chi5: true`) — CHI-5 becomes an **unscored watch** like CHI-4; the scored
  index is **CHI-1 + CHI-3, max 2**. `computeCHI` then returns `maxTotal = 2`, and `mapProbabilities`
  rescales its bands to the new max (On-track ≥ 83% of max, Hardening ≥ 50%) so the probability
  mapping stays coherent. CHI-5 still renders, as an unscored card.
- **(c) re-specify** — keep CHI-5 scored but change the spec so it can actually move (e.g. score the
  vol leg on a continuous <50% proximity instead of a hard 2-consecutive-quarters gate, and the
  haircut leg from the A1 trend once it accrues). Heavier; defer.

**Effect on today's data:**

| | scored components | total | max | band |
|-|-------------------|-------|-----|------|
| keep (default) | CHI-1 0.25 · CHI-3 0.5 · CHI-5 0 | **0.75** | 3 | Stalled / awaiting |
| demote | CHI-1 0.25 · CHI-3 0.5 | **0.75** | 2 | Stalled / awaiting (rescaled bands) |

Demoting doesn't change the *total* today (CHI-5 contributes 0) but it **raises the denominator's
honesty**: 0.75 / 2 is a truer read of a two-signal index than 0.75 / 3, and a future CHI-1/CHI-3
recovery isn't diluted by a structurally-dead third slot. The UI band-label table (`ProbMap`) is
hardcoded for max 3 and would need its thresholds relabelled if (b) is adopted.

**Risk.** Demoting loses the (real, if currently-silent) information that vol/haircut would carry in a
calmer regime; CHI-5 is the component that would light first if ETH vol normalised. Recommendation:
**keep CHI-5 scored for now** but revisit with option (c) once the A1 haircut trend has ≥2 quarters of
log — i.e. demote only if it's still pinned at 0 after the haircut leg has had a fair chance to move.

### ⚠ Separate operator confirmation — `thesis_clock_start`

`thesis_clock_start` anchors **every deadline criterion** (KC-1 5y, KC-4 3y, KC-7 2y) and the A3
`elevated` thresholds — a one-year error shifts KC-1's hit date by a year. **Resolved 2026-06-19:**
the operator set it to **`2026-06-01`** (observation window starts this month). New horizons:
KC-1 hit **2031-06-01** (elevated from 2029-06-01), KC-4 hit **2029-06-01**, KC-7 hit **2028-06-01**.
