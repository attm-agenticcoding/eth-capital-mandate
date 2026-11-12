// One-off: seed data/signals.json from this repository's own archived snapshots.
// Every data refresh commits data/latest.json, so each commit is a point-in-time
// observation. The pathway readings are recomputed from each archived snapshot's own
// raw fields. Nothing observed today is written back into the past, and
// data/history.* is not touched.
//   node scripts/seed-signals.mjs            write data/signals.json
//   node scripts/seed-signals.mjs --dry-run  print the daily table only
// Needs commit history (a shallow clone only seeds from the commits it has).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ETH_ALIGNED_CHAINS_STRICT } from '../src/lib/kill.mjs';
import { usdDebtByCollateral, burnOffsetPct, sharePct } from '../src/lib/indicators.mjs';
import { SCHEMA_VERSION } from '../src/lib/fetch-health.mjs';
import { RULES_VERSION, SIGNALS, advance, stateInfo } from '../src/lib/signals.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { maxBuffer: 1 << 28 }).toString();
const finite = (v) => typeof v === 'number' && Number.isFinite(v) ? v : null;
const number = (good, value) => good && finite(value) !== null ? { ok: true, v: value } : { ok: false };

// Readings an archived v2 snapshot supports. Fields that did not exist yet stay unavailable.
export function archivedReadings(snapshot) {
  const a = snapshot.auto || {}, ok = (g) => g?.health?.status === 'ok';
  const morpho = a.collateral?.perVenue?.find((v) => v.name === 'Morpho');
  const split = Array.isArray(morpho?.markets) && morpho.markets.length && ['ok', 'partial'].includes(morpho.health?.status)
    ? usdDebtByCollateral(morpho.markets) : { complete: false };
  // The per-chain rows were complete throughout; only the fixed-cohort lock withheld the
  // total. Recomputed here under the reviewed rule, at the same one-decimal precision.
  const rows = (a.stablecoins?.byChain || []).filter((r) => r.usdScope !== 'non-usd-only');
  const complete = rows.length > 0 && rows.every((r) => finite(r.usd) !== null && r.usd >= 0);
  const total = complete ? rows.reduce((sum, r) => sum + r.usd, 0) : null;
  const strict = new Set(ETH_ALIGNED_CHAINS_STRICT);
  const strictShare = total > 0 ? Number((rows.filter((r) => strict.has(r.name)).reduce((sum, r) => sum + r.usd, 0) / total * 100).toFixed(1)) : null;
  return {
    ethToBtcDebtRatio: number(split.complete, split.ethToBtcDebtRatio),
    usdDebtEthSharePct: number(split.complete, split.ethSharePct),
    lltvGapPp: number(split.complete, split.lltvGapPp),
    stakingRatioPct: number(ok(a.supply), sharePct(a.supply?.stakedEffectiveEth, a.supply?.totalSupplyEth, 3)),
    burnOffsetPct: number(ok(a.supply), burnOffsetPct(a.supply?.burn30dEth, a.supply?.issuance30dEth)),
    treasuryCohortEth: { ok: false },
    stableStrictSharePct: number(a.stablecoins?.health?.status !== 'failed' && !a.stablecoins?.stale, strictShare),
    ethBtcRange: { ok: false },
    issuanceEipStatus: { ok: false },
  };
}

function main() {
  const dry = process.argv.includes('--dry-run');
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'signals.json'), 'utf8'));
  const commits = git('log', '--format=%H', '--', 'data/latest.json').trim().split('\n').filter(Boolean).reverse();
  const byDay = new Map();
  for (const sha of commits) {
    let snapshot;
    try { snapshot = JSON.parse(git('show', `${sha}:data/latest.json`)); } catch { continue; }
    if (snapshot.schemaVersion !== SCHEMA_VERSION || !Number.isFinite(Date.parse(snapshot.generatedUtc))) continue;
    byDay.set(snapshot.generatedUtc.slice(0, 10), { sha, t: snapshot.generatedUtc, readings: archivedReadings(snapshot) });
  }
  let file = {};
  for (const { t, readings } of byDay.values()) file = advance(file, readings, config, t).file;
  if (!byDay.size) throw new Error('No archived v2 snapshots found; fetch more history first');
  const days = [...byDay.keys()];
  file.events = file.events.map((e) => ({ ...e, seeded: true }));
  file.seed = { firstDay: days[0], lastDay: days.at(-1), days: days.length, lastCommit: [...byDay.values()].at(-1).sha,
    note: 'Daily readings recomputed from archived data/latest.json commits; crossings found while seeding were never pushed' };
  console.log(`Seeded ${RULES_VERSION} from ${days.length} daily snapshots (${days[0]} to ${days.at(-1)})`);
  for (const def of SIGNALS) {
    const s = file.signals[def.id];
    console.log(`  ${def.id.padEnd(18)} ${String(stateInfo(def, s.state).label).padEnd(10)} since ${s.since ?? '—'}  ${s.dataOk ? def.reading(s.value, s.detail) : '（无读数）'}`);
  }
  for (const e of file.events) console.log(`  crossing ${e.t.slice(0, 10)} ${e.id}: ${e.from} -> ${e.to}`);
  if (!dry) fs.writeFileSync(path.join(ROOT, 'data', 'signals.json'), JSON.stringify(file, null, 2) + '\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
