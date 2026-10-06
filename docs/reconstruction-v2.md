# v2 reconstruction — 2026-10-06

## Why the former index was retired

The former CHI combined proxies for unrelated mechanisms into three components and mapped their sum to analyst price-probability bands. The mapping was not calibrated. Equal-weight exit voting also conflated correlated network-adoption measures and treated several unknown manual inputs as failure at deadlines.

The previous 401 observations and operator manual file are preserved. Old probability fields remain historical records, not current outputs. Retired compatibility functions explicitly return null for score, probability and exit verdict.

## Concrete problems corrected

1. Aave pool liquidity was labeled true borrower collateral. The combined collateral headline and synthetic 18-month Morpho-backfilled drift are removed.
2. Multi-asset restaking USD TVL / ETH price was labeled actual ETH. The true underlying and effective slashable measurements now remain unknown.
3. A single maximum Morpho LLTV was labeled an Aave/Morpho haircut regime. New Morpho output is debt-weighted, market-scoped, and descriptive; risk parameters are not identified convenience yields.
4. Two 91-day realized-volatility blocks were confused with six months of RV365 persistence. Actual daily, timestamped observations and calendar coverage are required.
5. A real 2026-09-29 CoinGecko 403 lost all market data because the fallback recovered metadata only. Complete market groups are now recovered with stale status; no missing data lowers a thesis score.
6. RWA category TVL fell around 80.2% between 2026-09-15 observations. Cause is not established. The discontinuity is flagged; no new issuance flow is inferred from stock changes.
7. Generic DA costs can include Ethereum, Celestia and EigenDA. They are not added indiscriminately to Ethereum fee revenue. Source-reported Ethereum fees and recipient-specific rent are separated from all-DA costs.
8. Missing fields never become zero; unknown, stale and invalid states are separate. Invalid dates and invalid numeric ranges dominate freshness labels.
9. Failed constituents do not silently change a comparison cohort. Observation time is separate from request time. Repeated fetching of one observation cannot prove elapsed persistence.
10. Legacy +10pp stress-share failure, inconsistent -5pp thresholds, unknown-correlation improvement, expired unread-manual hits and eight-row persistence no longer exist as decision rules. Dated, sourced facts can be inspected without a made-up pass/fail or transaction verdict.

## Current scope

This release delivers data semantics, provenance, failure handling, tests and a four-part evidence interface. It does not claim that token-level restaking de-duplication, AVS customer attribution, comparable collateral specialness or a valuation model have been completed.

The central research question is: who willingly bears the opportunity cost and risks of holding ETH for a service, and why can that service not be obtained more cheaply with a substitute?

## Verification requirements

- Run offline regressions, lint and production build
- Exercise normal and failed-source composed snapshots
- Confirm original history and manual blobs unchanged before publication
- Verify actual public-interface behavior and rendered desktop/mobile layout where the available cloud browser supports it
- After publish, verify the exact commit, GitHub Actions result and public served content

## Primary references

- https://github.com/DefiLlama/DefiLlama-Adapters/blob/main/projects/helper/aave.js
- https://aave.com/docs/aave-v3/smart-contracts/pool
- https://docs.morpho.org/learn/concepts/blue/
- https://github.com/Layr-Labs/eigenlayer-contracts/blob/main/docs/core/AllocationManager.md
- https://docs.llama.fi/real-world-assets/real-world-assets/methodology-and-metrics
- https://github.com/growthepie/gtp-backend/blob/76353b04563712801ac07f66ccff8b6b701f1cdb/backend/src/db_connector.py
