// Pure market-metric helpers shared by scripts/fetch.mjs and the test harness.
// No Node/browser APIs — keep importable from both.

// Drawdown from the TRUE all-time high (CoinGecko `ath`), as a positive magnitude %.
// CHI-1's "≥50% drawdown" trigger must read against the real ATH, not a rolling-window
// max: once the ATH slides out of a 365-day window the windowed drawdown shrinks abruptly
// even at a flat price, falsely relieving the trigger. Returns null on bad inputs.
export function drawdownPctFromAth(price, ath) {
  if (typeof price !== 'number' || !isFinite(price) || price < 0) return null;
  if (typeof ath !== 'number' || !isFinite(ath) || ath <= 0) return null;
  return (1 - price / ath) * 100;
}

// A6: alignment divergence = broad − strict Ethereum-aligned share (pp). A positive,
// WIDENING gap means ETH's headline aligned share is increasingly carried by the
// weakest-alignment chains (Polygon PoS, external-DA rollups). Pure; null on bad inputs.
export function alignmentGapPp(broadPct, strictPct) {
  if (typeof broadPct !== 'number' || !isFinite(broadPct)) return null;
  if (typeof strictPct !== 'number' || !isFinite(strictPct)) return null;
  return Math.round((broadPct - strictPct) * 10) / 10;
}
// Trend of that gap from the longitudinal log: { gap, widenedPp } where widenedPp > 0 means
// the gap has grown since tracking began. `gapField` is the logged broad−strict pp series.
export function alignmentDivergenceTrend(currentGap, hist, gapField) {
  const vals = (Array.isArray(hist) ? hist : [])
    .map((r) => r && r[gapField])
    .filter((v) => typeof v === 'number' && isFinite(v));
  if (typeof currentGap !== 'number') return { gap: null, widenedPp: null };
  const widenedPp = vals.length ? Math.round((currentGap - vals[0]) * 10) / 10 : null;
  return { gap: currentGap, widenedPp };
}
