// Evaluate the pathway signals against the latest snapshot, push state crossings to
// ntfy when NTFY_TOPIC is set, and write data/signals.json.
//   node scripts/signals.mjs                 evaluate, push, write
//   node scripts/signals.mjs --dry-run       print only; no push, no write
//   node scripts/signals.mjs --snapshot <f>  read a snapshot from another path
// Without NTFY_TOPIC the evaluation still runs and is written; nothing is pushed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES_VERSION, SIGNALS, readSnapshot, advance, messageFor, connectMessage, stateInfo } from '../src/lib/signals.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } };
const RETRY_HOURS = 72;

export async function publish(messages, { topic, page, fetchImpl = globalThis.fetch }) {
  const results = [];
  for (const m of messages) {
    try {
      const response = await fetchImpl('https://ntfy.sh/', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic, title: m.title, message: m.body, priority: m.priority, tags: m.tags || [], click: `${page}#signals` }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      results.push(true);
    } catch (e) { results.push(false); console.error('ntfy push failed:', e instanceof Error ? e.message : String(e)); }
  }
  return results;
}

export async function evaluate({ snapshot, previous, config, now = new Date().toISOString(), topic = null, fetchImpl, dry = false }) {
  if (config.rulesVersion !== RULES_VERSION) throw new Error(`config/signals.json is for ${config.rulesVersion}; code is ${RULES_VERSION}`);
  // The snapshot is judged as of its own generation time, so a late evaluation cannot
  // turn a reading it already held into a stale one.
  const asOf = snapshot.generatedUtc || now;
  const { file, changes } = advance(previous, readSnapshot(snapshot, asOf), config, asOf);
  const due = file.events.filter((e) => e.notify && !e.pushed && !e.seeded && Date.parse(asOf) - Date.parse(e.t) <= RETRY_HOURS * 3600000);
  const messages = due.map((e) => ({ event: e, ...messageFor(e, file) }));
  const firstConnect = !!topic && file.push.channel !== 'ntfy';
  if (topic && !dry) {
    const outgoing = [...(firstConnect ? [connectMessage(file)] : []), ...messages];
    const sent = await publish(outgoing, { topic, page: config.page, fetchImpl });
    const offset = firstConnect ? 1 : 0;
    if (firstConnect && sent[0]) file.push = { ...file.push, channel: 'ntfy', connectedAt: now };
    messages.forEach((m, i) => { if (sent[i + offset]) m.event.pushed = true; });
    if (sent.some(Boolean)) file.push = { ...file.push, lastPushAt: now };
  }
  return { file, changes, messages, firstConnect };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dry = process.argv.includes('--dry-run');
  const at = process.argv.indexOf('--snapshot');
  const snapshotPath = at > 0 ? process.argv[at + 1] : path.join(ROOT, 'data', 'latest.json');
  const target = path.join(ROOT, 'data', 'signals.json');
  const snapshot = readJson(snapshotPath, null);
  if (!snapshot) throw new Error(`Snapshot not found: ${snapshotPath}`);
  evaluate({ snapshot, previous: readJson(target, {}), config: readJson(path.join(ROOT, 'config', 'signals.json'), null),
    topic: process.env.NTFY_TOPIC || null, dry }).then(({ file, changes, messages, firstConnect }) => {
    for (const def of SIGNALS) {
      const s = file.signals[def.id];
      console.log(`${def.id.padEnd(18)} ${String(stateInfo(def, s.state).label).padEnd(10)} ${s.dataOk ? def.reading(s.value, s.detail) : '（本次无可用读数，状态沿用）'}${s.pending ? `  ｜待确认 ${stateInfo(def, s.pending.state).label} ${s.pending.days}/${s.pending.needed}` : ''}`);
    }
    console.log(`${changes.length} state change(s); ${messages.length} message(s) due; push ${process.env.NTFY_TOPIC ? (dry ? 'configured (dry run, not sent)' : firstConnect ? 'connected' : 'configured') : 'not configured'}`);
    for (const m of messages) console.log(`[push] ${m.title} — ${m.body}`);
    if (!dry) fs.writeFileSync(target, JSON.stringify(file, null, 2) + '\n');
  }).catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
}
