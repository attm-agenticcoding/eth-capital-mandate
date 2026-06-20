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
