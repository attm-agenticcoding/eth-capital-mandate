import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RULES_VERSION, SIGNALS, readSnapshot, rawState, advance, messageFor, connectMessage, describeSignals, stateInfo } from '../src/lib/signals.mjs';
import { evaluate } from '../scripts/signals.mjs';
import { archivedReadings } from '../scripts/seed-signals.mjs';

const config = JSON.parse(fs.readFileSync(new URL('../config/signals.json', import.meta.url), 'utf8'));
const DAY = 86400000, T0 = Date.parse('2026-10-01T06:00:00Z');
const at = (i, hour = 6) => new Date(Date.parse('2026-10-01T00:00:00Z') + i * DAY + hour * 3600000).toISOString();
const def = (id) => SIGNALS.find((s) => s.id === id);
const none = () => Object.fromEntries(SIGNALS.map((s) => [s.field, { ok: false }]));
const reading = (fields) => ({ ...none(), ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v === null ? { ok: false } : typeof v === 'object' ? v : { ok: true, v }])) });
// Feed one reading per day; returns the final file and every change in order.
function walk(values, field, start = {}, from = 0) {
  let file = start; const changes = [];
  values.forEach((v, i) => { const step = advance(file, reading({ [field]: v }), config, at(from + i)); file = step.file; changes.push(...step.changes); });
  return { file, changes };
}

test('configuration covers every signal and matches the rule version', () => {
  assert.equal(config.rulesVersion, RULES_VERSION);
  for (const s of SIGNALS) assert.ok(config.signals[s.id], s.id);
  assert.deepEqual(Object.keys(config.signals).sort(), SIGNALS.map((s) => s.id).sort());
  assert.equal(new Set(SIGNALS.map((s) => s.id)).size, SIGNALS.length);
});

test('the first evaluation records a state without calling it a crossing', () => {
  const { file, changes } = walk([49.6], 'stableStrictSharePct');
  assert.equal(file.signals['stable-majority'].state, 'minority'); assert.equal(changes.length, 0); assert.deepEqual(file.events, []);
  assert.equal(file.signals['stable-majority'].since, '2026-10-01');
});

test('a line crossing needs the configured number of distinct observation days', () => {
  const { file, changes } = walk([50.9, 50.8, 49.9, 49.8, 49.6], 'stableStrictSharePct');
  assert.equal(changes.length, 1);
  assert.deepEqual({ ...changes[0], t: null }, { t: null, id: 'stable-majority', from: 'majority', to: 'minority', value: 49.6, notify: true });
  assert.equal(file.signals['stable-majority'].since, '2026-10-03');
  // Two days below, then back above: nothing happened.
  assert.equal(walk([50.9, 49.9, 49.8, 50.2, 50.3, 50.1], 'stableStrictSharePct').changes.length, 0);
});

test('repeat runs within one day cannot manufacture confirmation', () => {
  let file = walk([50.9], 'stableStrictSharePct').file;
  for (const hour of [0, 6, 12, 18]) file = advance(file, reading({ stableStrictSharePct: 49.5 }), config, at(1, hour)).file;
  assert.equal(file.signals['stable-majority'].state, 'majority');
  assert.deepEqual(file.signals['stable-majority'].pending, { state: 'minority', days: 1, needed: 3 });
  assert.equal(file.raw['stable-majority'].length, 2); assert.equal(file.series.stableStrictSharePct.length, 2);
});

test('a missing reading keeps the state, flags it, and adds no observation', () => {
  const before = walk([50.9, 50.8], 'stableStrictSharePct').file;
  const { file, changes } = advance(before, none(), config, at(2));
  assert.equal(changes.length, 0); assert.equal(file.signals['stable-majority'].state, 'majority');
  assert.equal(file.signals['stable-majority'].dataOk, false); assert.equal(file.signals['stable-majority'].value, 50.8);
  assert.equal(file.series.stableStrictSharePct.length, 2);
  // A signal that never had a reading stays stateless rather than neutral.
  assert.equal(file.signals['treasury-flow'].state, null); assert.equal(file.signals['treasury-flow'].dataOk, false);
});

test('observations separated by an outage do not confirm a crossing', () => {
  let file = walk([50.9, 49.5, 49.5], 'stableStrictSharePct').file;
  const late = advance(file, reading({ stableStrictSharePct: 49.5 }), config, at(12));
  assert.equal(late.changes.length, 0); assert.equal(late.file.signals['stable-majority'].state, 'majority');
  file = late.file;
  const resumed = walk([49.5, 49.5], 'stableStrictSharePct', file, 13);
  assert.equal(resumed.changes.length, 1); assert.equal(resumed.file.signals['stable-majority'].state, 'minority');
});

test('rank, gap and burn lines classify at their structural thresholds', () => {
  const state = (id, v) => rawState(def(id), config.signals[id], [], { ok: true, v }, '2026-10-01').state;
  assert.equal(state('collateral-rank', 0.32), 'btc_leads'); assert.equal(state('collateral-rank', 1), 'eth_leads');
  assert.equal(state('burn-line', 3.07), 'below'); assert.equal(state('burn-line', 10), 'above');
  assert.equal(state('lltv-privilege', 0), 'parity'); assert.equal(state('lltv-privilege', 0.5), 'parity');
  assert.equal(state('lltv-privilege', 2.5), 'positive'); assert.equal(state('lltv-privilege', -2.5), 'negative');
  assert.equal(rawState(def('burn-line'), config.signals['burn-line'], [], { ok: false }, '2026-10-01').state, null);
});

test('band signal waits for history, then uses median and MAD with a noise floor', () => {
  const cfg = config.signals['collateral-share'], signal = def('collateral-share');
  const series = (values) => values.map((v, i) => ({ d: at(i).slice(0, 10), v }));
  const flat = series(Array.from({ length: 40 }, () => 15));
  assert.equal(rawState(signal, cfg, flat.slice(0, 20), { ok: true, v: 10 }, at(20).slice(0, 10)).state, 'accruing');
  // MAD is zero on a flat series, so the floor alone sets the band.
  const day = at(40).slice(0, 10);
  assert.equal(rawState(signal, cfg, flat, { ok: true, v: 15 - cfg.floor }, day).state, 'in_range');
  assert.equal(rawState(signal, cfg, flat, { ok: true, v: 15 - cfg.floor - 0.01 }, day).state, 'breakout_down');
  assert.equal(rawState(signal, cfg, flat, { ok: true, v: 15 + cfg.floor + 0.01 }, day).state, 'breakout_up');
  // A noisy series widens the band: 3 x 1.4826 x MAD(=1) around a median of 15.
  const noisy = series(Array.from({ length: 40 }, (_, i) => 15 + (i % 2 ? 1 : -1)));
  const wide = rawState(signal, cfg, noisy, { ok: true, v: 11 }, day);
  assert.equal(wide.state, 'in_range'); assert.ok(Math.abs(wide.detail.width - 3 * 1.4826) < 1e-9);
  assert.equal(rawState(signal, cfg, noisy, { ok: true, v: 10.5 }, day).state, 'breakout_down');
  // Today's own value is never part of the window it is judged against.
  assert.equal(rawState(signal, cfg, [...flat, { d: day, v: 0 }], { ok: true, v: 15 }, day).detail.center, 15);
});

test('leaving warm-up is a first classification and is not pushed', () => {
  const values = [...Array.from({ length: 31 }, () => 15), 12, 12, 12];
  const { file, changes } = walk(values, 'usdDebtEthSharePct');
  assert.equal(file.signals['collateral-share'].state, 'breakout_down');
  const share = changes.filter((c) => c.id === 'collateral-share');
  assert.deepEqual(share.map((c) => [c.from, c.to, c.notify]), [['accruing', 'breakout_down', false]]);
});

test('trend signal compares with the reading a window ago and has a dead band', () => {
  const up = walk(Array.from({ length: 36 }, (_, i) => 35.8 + i * 0.015), 'stakingRatioPct');
  assert.equal(up.file.signals['staking-flow'].state, 'rising');
  assert.ok(Math.abs(up.file.signals['staking-flow'].detail.change - 0.45) < 1e-9);
  assert.equal(up.changes.find((c) => c.id === 'staking-flow').notify, false);
  const down = walk(Array.from({ length: 12 }, (_, i) => 36.3 - i * 0.08), 'stakingRatioPct', up.file, 36);
  // The 30-day change passes through the dead band on a single day, which confirms nothing;
  // three falling days in a row then do.
  const crossing = down.changes.filter((c) => c.id === 'staking-flow' && c.notify);
  assert.deepEqual(crossing.map((c) => [c.from, c.to]), [['rising', 'falling']]);
  assert.deepEqual(down.file.raw['staking-flow'].slice(40, 44).map((r) => r.s), ['flat', 'falling', 'falling', 'falling']);
  assert.equal(down.file.signals['staking-flow'].since, at(41).slice(0, 10));
  // Without a reading near the reference date the trend is not computed.
  const sparse = [{ d: '2026-08-01', v: 30 }];
  assert.equal(rawState(def('staking-flow'), config.signals['staking-flow'], sparse, { ok: true, v: 36 }, '2026-10-01').state, 'accruing');
  // Treasury flow is relative: 7.00M to 6.90M over the window is a 1.43% fall.
  const cohort = [{ d: '2026-09-01', v: 7.0e6 }];
  const fall = rawState(def('treasury-flow'), config.signals['treasury-flow'], cohort, { ok: true, v: 6.9e6 }, '2026-10-01');
  assert.equal(fall.state, 'falling'); assert.ok(Math.abs(fall.detail.change + 1.4285714) < 1e-6);
});

test('ETH/BTC extreme is read from the range, and a status change of the proposal is immediate', () => {
  const range = (daysSinceLow, daysSinceHigh) => ({ ok: true, v: 0.0278, range: { status: 'observed', low: 0.0258, high: 0.0361, positionPct: 19, daysSinceLow, daysSinceHigh } });
  const first = advance({}, reading({ ethBtcRange: range(157, 295), issuanceEipStatus: { ok: true, v: 'Draft' } }), config, at(0));
  assert.equal(first.file.signals['ethbtc-range'].state, 'in_range'); assert.equal(first.file.signals['issuance-eip'].state, 'Draft');
  const next = advance(first.file, reading({ ethBtcRange: range(0, 296), issuanceEipStatus: { ok: true, v: 'Last Call' } }), config, at(1));
  assert.deepEqual(next.changes.map((c) => [c.id, c.from, c.to, c.notify]), [['ethbtc-range', 'in_range', 'at_low', true], ['issuance-eip', 'Draft', 'Last Call', true]]);
  assert.equal(stateInfo(def('issuance-eip'), 'Last Call').label, 'Last Call');
});

test('only healthy groups supply readings from a snapshot', () => {
  const NOW = '2026-11-11T12:00:00.000Z';
  const ok = { status: 'ok', fetchedAt: NOW, observedAt: null, lastSuccessAt: NOW, ttlHours: 48 };
  const snapshot = { schemaVersion: 2, generatedUtc: NOW, auto: {
    _market: { health: ok }, ratio: { now: 0.0278, range365: { status: 'observed', low: 0.0258, high: 0.0361, positionPct: 19, daysSinceLow: 157, daysSinceHigh: 295 }, health: ok },
    supply: { stakedEffectiveSharePct: 36.36, burnOffsetPct: 3.07, health: ok },
    stablecoins: { ethAlignedSharePctStrict: 49.6, health: ok },
    collateral: { health: { ...ok, status: 'partial' }, usdDebtByCollateral: { ethSharePct: 13.1, ethToBtcDebtRatio: 0.32, lltvGapPp: 0, health: ok } },
    treasuries: { cohortHoldingsEth: 7.6e6, health: ok }, policy: { issuanceEipStatus: 'Draft', health: ok } } };
  const all = readSnapshot(snapshot, NOW);
  for (const s of SIGNALS) assert.equal(all[s.field].ok, true, s.field);
  assert.equal(all.usdDebtEthSharePct.v, 13.1); assert.equal(all.lltvGapPp.v, 0); assert.equal(all.issuanceEipStatus.v, 'Draft');
  const broken = structuredClone(snapshot);
  broken.auto.supply.health.status = 'stale'; broken.auto.collateral.usdDebtByCollateral.health.status = 'partial';
  broken.auto.treasuries.cohortHoldingsEth = null; broken.auto.ratio.range365.status = 'unknown'; broken.auto.stablecoins.health.status = 'partial';
  delete broken.auto.policy;
  const some = readSnapshot(broken, NOW);
  for (const field of ['stakingRatioPct', 'burnOffsetPct', 'usdDebtEthSharePct', 'ethToBtcDebtRatio', 'lltvGapPp', 'treasuryCohortEth', 'ethBtcRange', 'stableStrictSharePct', 'issuanceEipStatus']) assert.equal(some[field].ok, false, field);
  // Past its time-to-live a group is stale however it was labelled when fetched.
  assert.equal(readSnapshot(snapshot, '2026-11-20T00:00:00.000Z').stakingRatioPct.ok, false);
  assert.equal(readSnapshot({}, NOW).stableStrictSharePct.ok, false);
});

test('messages state the fact and never an instruction', () => {
  const { file, changes } = walk([50.9, 50.8, 49.9, 49.8, 49.6], 'stableStrictSharePct');
  const message = messageFor(changes[0], file);
  assert.match(message.title, /稳定币主场/); assert.match(message.body, /过半 → 不足半数/); assert.match(message.body, /49\.6%/);
  assert.match(message.body, /不是交易指令/); assert.equal(message.priority, 4); assert.deepEqual(message.tags, ['warning']);
  assert.doesNotMatch(JSON.stringify([message, connectMessage(file)]), /买入|卖出|减仓|加仓|概率|目标价/);
  assert.match(connectMessage(file).body, /稳定币主场：不足半数/);
});

test('page rows read the stored file and never invent a state', () => {
  const empty = describeSignals({}, config);
  assert.equal(empty.usable, false); assert.equal(empty.rows.length, SIGNALS.length);
  assert.ok(empty.rows.every((r) => r.state === null && r.stateLabel === '无数据' && r.reading === '尚无可用读数' && r.rule.length > 20));
  assert.equal(describeSignals({ rulesVersion: 'older', signals: { 'burn-line': { state: 'above' } } }, config).rows.find((r) => r.id === 'burn-line').state, null);
  const { file } = walk([50.9, 50.8, 49.9, 49.8, 49.6], 'stableStrictSharePct');
  const view = describeSignals(file, config), row = view.rows.find((r) => r.id === 'stable-majority');
  assert.equal(row.stateLabel, '不足半数'); assert.equal(row.tone, 'adverse'); assert.equal(row.since, '2026-10-03'); assert.match(row.reading, /49\.6%/);
  assert.deepEqual(view.events.map((e) => [e.label, e.from, e.to]), [['稳定币主场', '过半', '不足半数']]);
  for (const key of ['score', 'probability', 'total', 'verdict']) assert.equal(key in view, false);
});

test('pushes go out only with a topic, once, and are retried after a failure', async () => {
  const NOW = '2026-11-12T06:00:00.000Z';
  const ok = { status: 'ok', fetchedAt: NOW, observedAt: null, lastSuccessAt: NOW, ttlHours: 48 };
  const snapshotAt = (t, share) => ({ schemaVersion: 2, generatedUtc: t, auto: { stablecoins: { ethAlignedSharePctStrict: share, health: { ...ok, fetchedAt: t, lastSuccessAt: t } } } });
  const calls = []; let failing = false;
  const fetchImpl = async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: !failing, status: failing ? 500 : 200 }; };
  const run = (previous, day, share, topic, extra = {}) => evaluate({ snapshot: snapshotAt(`2026-11-${day}T06:00:00.000Z`, share), previous, config, topic, fetchImpl, now: NOW, ...extra });
  // No topic: evaluated and recorded, nothing sent.
  let state = (await run({}, '01', 50.9, null)).file;
  for (const day of ['02', '03', '04']) state = (await run(state, day, 49.5, null)).file;
  assert.equal(calls.length, 0); assert.equal(state.signals['stable-majority'].state, 'minority');
  assert.equal(state.events.length, 1); assert.equal(state.events[0].pushed, false); assert.equal(state.push.channel, null);
  // Topic added: one connect message plus the crossing still inside the retry window.
  failing = true;
  const failed = await run(state, '05', 49.5, 'secret-topic');
  assert.equal(calls.length, 2); assert.equal(failed.file.push.channel, null); assert.equal(failed.file.events[0].pushed, false);
  failing = false; calls.length = 0;
  const sent = await run(failed.file, '05', 49.5, 'secret-topic');
  assert.deepEqual(calls.map((c) => c.body.title), ['ETH 路径信号推送已接通', 'ETH 信号跨档｜稳定币主场']);
  assert.ok(calls.every((c) => c.url === 'https://ntfy.sh/' && c.body.topic === 'secret-topic' && c.body.click.endsWith('#signals')));
  assert.equal(sent.file.push.channel, 'ntfy'); assert.equal(sent.file.events[0].pushed, true);
  assert.doesNotMatch(JSON.stringify(sent.file), /secret-topic/);
  calls.length = 0;
  const quiet = await run(sent.file, '06', 49.5, 'secret-topic');
  assert.equal(calls.length, 0); assert.equal(quiet.messages.length, 0);
  // Dry runs and seeded history never reach the network.
  const dry = await run(state, '05', 49.5, 'secret-topic', { dry: true });
  assert.equal(calls.length, 0); assert.equal(dry.messages.length, 1);
  const seeded = { ...state, events: state.events.map((e) => ({ ...e, seeded: true })) };
  assert.equal((await run(seeded, '05', 49.5, null)).messages.length, 0);
  await assert.rejects(() => run({}, '01', 50, null, { config: { ...config, rulesVersion: 'other' } }), /config\/signals\.json/);
});

test('archived snapshots yield only the readings their own data supports', () => {
  const ok = { status: 'ok' };
  const snapshot = { auto: {
    supply: { stakedEffectiveEth: 44.4e6, totalSupplyEth: 122.1e6, burn30dEth: 2747, issuance30dEth: 89496, health: ok },
    stablecoins: { health: { status: 'partial' }, byChain: [{ name: 'Ethereum', usd: 460 }, { name: 'Base', usd: 30 }, { name: 'Arbitrum', usd: 6 }, { name: 'Tron', usd: 300 }, { name: 'Solana', usd: 204 }, { name: 'Concordium', usd: null, usdScope: 'non-usd-only' }] },
    collateral: { perVenue: [{ name: 'Morpho', health: { status: 'partial' }, markets: [
      { collateralSymbol: 'wstETH', loanSymbol: 'USDC', borrowUsd: 100, lltvPct: 86 }, { collateralSymbol: 'cbBTC', loanSymbol: 'USDC', borrowUsd: 300, lltvPct: 86 }] }] } } };
  const r = archivedReadings(snapshot);
  assert.equal(r.stableStrictSharePct.v, 49.6); assert.equal(r.usdDebtEthSharePct.v, 25); assert.equal(r.ethToBtcDebtRatio.v, 0.3333); assert.equal(r.lltvGapPp.v, 0);
  assert.equal(r.stakingRatioPct.v, 36.364); assert.equal(r.burnOffsetPct.v, 3.069);
  for (const field of ['treasuryCohortEth', 'ethBtcRange', 'issuanceEipStatus']) assert.equal(r[field].ok, false);
  snapshot.auto.stablecoins.byChain[3].usd = null; snapshot.auto.supply.health.status = 'stale';
  const partial = archivedReadings(snapshot);
  assert.equal(partial.stableStrictSharePct.ok, false); assert.equal(partial.stakingRatioPct.ok, false);
});

test('the committed signal state is well formed and carries no score', () => {
  const file = JSON.parse(fs.readFileSync(new URL('../data/signals.json', import.meta.url), 'utf8'));
  assert.equal(file.rulesVersion, RULES_VERSION); assert.ok(Number.isFinite(Date.parse(file.updatedAt)));
  for (const s of SIGNALS) {
    const entry = file.signals[s.id]; assert.ok(entry, s.id);
    if (entry.state !== null && s.kind !== 'category') assert.ok(s.states[entry.state], `${s.id}: ${entry.state}`);
  }
  assert.doesNotMatch(JSON.stringify(file), /"(?:score|probability|probabilities|chi|p10k|p20k|target|verdict)"/i);
  assert.ok(file.events.every((e) => e.pushed === true || e.pushed === false));
  assert.ok(T0 > 0);
});
