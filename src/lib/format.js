// Display formatters.
export const fmtUsd = (n, d) => {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(d ?? 2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(d ?? 2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(d ?? 2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(d ?? 1)}k`;
  return `${s}$${a.toFixed(d ?? 0)}`;
};
export const fmtNum = (n, d = 0) =>
  n == null || !isFinite(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d });
export const fmtPct = (n, d = 1) => (n == null || !isFinite(n) ? '—' : `${n.toFixed(d)}%`);
export const fmtSignedPct = (n, d = 1) => (n == null || !isFinite(n) ? '—' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(d)}%`);
export const fmtSigned = (n, d = 0) => (n == null || !isFinite(n) ? '—' : `${n >= 0 ? '+' : '−'}${fmtNum(Math.abs(n), d)}`);
export const fmtEth = (n, d = 0) => (n == null ? '—' : `${fmtNum(n, d)} ETH`);

export function timeAgo(iso) {
  if (!iso) return 'awaiting';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 0) return 'just now';
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
export const fmtUtc = (iso) => (iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—');
