// Token families shared by ingestion, indicators and tests. Pure; no Node/browser APIs.
// Membership is explicit. An unlisted symbol is `other`, never guessed from its name.
export const ETH_SET = new Set(['ETH', 'WETH', 'STETH', 'WSTETH', 'WEETH', 'RETH', 'CBETH', 'ETHX', 'EZETH', 'OSETH', 'RSETH', 'TETH', 'SFRXETH', 'FRXETH', 'METH', 'CMETH', 'SWETH', 'RSWETH', 'PUFETH', 'LSETH', 'OETH', 'UNIETH', 'ANKRETH', 'MSETH', 'WBETH', 'EETH', 'APXETH', 'PXETH', 'YNETH', 'INETH', 'WOETH']);
export const BTC_SET = new Set(['BTC', 'WBTC', 'CBBTC', 'TBTC', 'LBTC', 'EBTC', 'FBTC', 'BTCB', 'SOLVBTC', 'KBTC', 'PUMPBTC', 'UNIBTC', 'SWBTC', 'XBTC', 'BTC.B']);
// Explicit USD assets only. Gold and EUR assets are not USD stable financing.
export const USD_SET = new Set(['DAI', 'GHO', 'FRAX', 'LUSD', 'SDAI', 'SUSDS', 'SUSDE', 'USDE', 'RLUSD', 'PYUSD', 'TUSD', 'CRVUSD', 'GUSD', 'FDUSD', 'USDD', 'MUSD', 'EUSDE', 'USD0', 'USDG', 'USDTB', 'SYRUPUSDT', 'USDS', 'USDC', 'USDT']);
export function classifyToken(raw) {
  const s = String(raw || '').toUpperCase();
  if (ETH_SET.has(s)) return 'eth';
  if (BTC_SET.has(s)) return 'btc';
  if (USD_SET.has(s)) return 'stable';
  return 'other';
}
export const isUsdStable = (raw) => USD_SET.has(String(raw || '').toUpperCase());
