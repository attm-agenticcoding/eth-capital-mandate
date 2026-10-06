// Pure data-quality helpers. A successful HTTP request is not an observation timestamp.
export const SCHEMA_VERSION = 2;
export const METHODOLOGY_VERSION = 'eth-evidence-v2';
export const DAY_MS = 86400000;
export const numberOrNull = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
export const round = (value, places = 2) => {
  const n = numberOrNull(value);
  return n === null ? null : Number(n.toFixed(places));
};
export const sumComplete = (values) => values.length && values.every((v) => numberOrNull(v) !== null)
  ? values.reduce((sum, v) => sum + Number(v), 0) : null;
export const percent = (part, total, places = 2) => numberOrNull(part) !== null && numberOrNull(total) > 0
  ? round(Number(part) / Number(total) * 100, places) : null;
export function observationTime(value, now) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string') {
    const date = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
    if (!date) return null;
    const [year, month, day] = date.slice(1, 4).map(Number);
    const calendar = new Date(Date.UTC(year, month - 1, day));
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
    if (date[4] && (Number(date[4]) > 23 || Number(date[5]) > 59 || Number(date[6] || 0) > 59)) return null;
  }
  const n = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
  return Number.isFinite(n) && n >= 0 && n <= Date.parse(now) ? new Date(n).toISOString() : null;
}
export function oldestObservation(values, now) {
  const valid = values.map((v) => observationTime(v, now));
  return valid.length && valid.every(Boolean) ? valid.sort()[0] : null;
}
export function makeHealth({ status = 'ok', now, observedAt = null, previous = null, ttlHours = 48,
  reason = null, cohortId = null, coverage = null }) {
  const observation = observationTime(observedAt, now);
  if (observedAt !== null && !observation) {
    status = 'partial';
    reason = [reason, 'Invalid or future upstream observation timestamp rejected'].filter(Boolean).join('; ');
  }
  if (status === 'ok' && observation && Date.parse(now) - Date.parse(observation) > ttlHours * 3600000) {
    status = 'stale';
    reason = [reason, 'Upstream observation exceeds TTL'].filter(Boolean).join('; ');
  }
  return { status, fetchedAt: now, observedAt: observation,
    lastSuccessAt: status === 'ok' ? now : previous?.lastSuccessAt ?? null,
    ttlHours, reason, cohortId, coverage };
}
export function groupHealth(sources, { now, previous, cohortId = null, coverage = null, reason = null } = {}) {
  const hs = Object.values(sources);
  const oks = hs.filter((h) => h.status === 'ok').length;
  const status = hs.length && oks === hs.length ? 'ok'
    : hs.length && hs.every((h) => h.status === 'failed') ? 'failed'
      : hs.length && hs.every((h) => h.status === 'ok' || h.status === 'stale') ? 'stale' : 'partial';
  return makeHealth({ status, now, previous, observedAt: oldestObservation(hs.map((h) => h.observedAt), now),
    ttlHours: hs.length ? Math.min(...hs.map((h) => h.ttlHours)) : 48, cohortId, coverage,
    reason: reason || (status === 'ok' ? null : hs.filter((h) => h.status !== 'ok').map((h) => h.reason || h.status).join('; ')) });
}
export function stamp(value, health, sources = {}) {
  return { ...value, health, sources, asOf: health.observedAt, stale: health.status === 'stale', unavailable: health.status === 'failed' };
}
// Fixed-membership cohorts never silently lose a constituent and retain a headline.
export function preserveCohort(current, previous, { cohortId, aggregateKeys = [] }) {
  if (current.health.status === 'ok') return current;
  if (previous?.health?.cohortId === cohortId && ['ok', 'stale'].includes(previous.health.status)) {
    const health = { ...current.health, status: 'stale', observedAt: previous.health.observedAt,
      lastSuccessAt: previous.health.lastSuccessAt, reason: `Frozen complete cohort: ${current.health.reason || 'constituent unavailable'}`,
      coverage: { ...current.health.coverage, frozen: true } };
    return stamp({ ...previous, currentAttempt: { perVenue: current.perVenue, byProtocol: current.byProtocol } }, health, current.sources);
  }
  const result = { ...current };
  for (const key of aggregateKeys) result[key] = null;
  return result;
}
// A point-in-time RV365 series must cover elapsed time; 91-day realized blocks are not RV365 persistence.
export function rv365Persistence(rows, current, now, { days = 183, threshold = 50, maxGapHours = 36 } = {}) {
  const start = Date.parse(now) - days * DAY_MS;
  const usable = [...rows, current].filter((r) => r?.schemaVersion === SCHEMA_VERSION
      && r.methodologyVersion === METHODOLOGY_VERSION && r.groupHealth?.vol?.status === 'ok'
      && numberOrNull(r.vol365) !== null && observationTime(r.t, now)
      && observationTime(r.groupHealth.vol.observedAt, r.t))
    .map((r) => ({ t: Date.parse(r.groupHealth.vol.observedAt), value: r.vol365 })).sort((a, b) => a.t - b.t);
  const unique = [...new Map(usable.map((r) => [r.t, r])).values()];
  const predecessor = unique.filter((r) => r.t <= start).at(-1);
  const window = [...(predecessor ? [predecessor] : []), ...unique.filter((r) => r.t > start)];
  const gaps = window.slice(1).map((r, i) => r.t - window[i].t);
  const covered = !!predecessor && window.length > 1 && Date.parse(now) - window.at(-1).t <= maxGapHours * 3600000
    && gaps.every((g) => g <= maxGapHours * 3600000);
  return { status: covered ? 'observed' : 'unknown', belowThreshold: covered ? window.every((r) => r.value < threshold) : null,
    thresholdPct: threshold, requiredDays: days, elapsedDays: window.length > 1 ? round((window.at(-1).t - window[0].t) / DAY_MS, 2) : 0,
    samples: window.length, maxGapHours, reason: covered ? null : 'Insufficient point-in-time RV365 history with elapsed-time coverage' };
}
