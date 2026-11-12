// Pathway signals: each one watches a single observable reading and reports when it
// crosses from one state to another. There is no total, no probability and no trade
// instruction. Missing, stale or partial data never moves a state.
import { groupHealth } from './evidence.mjs';

export const RULES_VERSION = 'pathway-signals-v1';
const DAY = 86400000;
const finite = (v) => typeof v === 'number' && Number.isFinite(v) ? v : null;
const dayOf = (iso) => new Date(iso).toISOString().slice(0, 10);
const median = (values) => {
  const s = values.slice().sort((a, b) => a - b), mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const fmt = (v, digits = 1) => finite(v) === null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const signed = (v, digits = 2) => finite(v) === null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), digits)}`;

export const PATHS = { collateral: '抵押品', sinks: '锁仓', home: '主场', fees: '费用', premium: '相对强弱', policy: '货币政策' };
export const TONES = { supportive: '支持', adverse: '不利', neutral: '中性' };
const ACCRUING = { label: '累积中', tone: 'neutral', meaning: '历史观测还不够，暂不判断' };

// `field` names the reading consumed. `states` lists every state the rule can produce.
export const SIGNALS = [
  { id: 'collateral-rank', path: 'collateral', kind: 'line', field: 'ethToBtcDebtRatio',
    label: '美元信贷的首选抵押品', question: '借美元时，市场押的是 ETH 还是 BTC？',
    above: 'eth_leads', below: 'btc_leads',
    states: { eth_leads: { label: 'ETH 领先', tone: 'supportive', meaning: 'Morpho 上由 ETH 类抵押支持的美元债务超过 BTC 类' },
      btc_leads: { label: 'BTC 领先', tone: 'adverse', meaning: 'Morpho 上由 BTC 类抵押支持的美元债务超过 ETH 类' } },
    reading: (v) => `ETH 类 ÷ BTC 类 = ${fmt(v, 2)}`,
    rule: (c) => `Morpho 以太坊主网、贷出资产为美元稳定币的市场：ETH 类抵押对应债务 ÷ BTC 类抵押对应债务。跨过 ${c.line} 且连续 ${c.confirmDays} 个观测日才换位。` },
  { id: 'collateral-share', path: 'collateral', kind: 'band', field: 'usdDebtEthSharePct',
    label: 'ETH 抵押份额的走向', question: 'ETH 在美元信贷抵押品里的份额，是否走出了自己的常态区间？',
    states: { breakout_up: { label: '向上突破', tone: 'supportive', meaning: 'ETH 类抵押份额高于自身近期常态区间' },
      in_range: { label: '区间内', tone: 'neutral', meaning: 'ETH 类抵押份额在自身近期常态区间内' },
      breakout_down: { label: '向下突破', tone: 'adverse', meaning: 'ETH 类抵押份额低于自身近期常态区间' }, accruing: ACCRUING },
    reading: (v, d) => `${fmt(v, 1)}%${d?.lower != null ? `，常态区间 ${fmt(d.lower, 1)}%–${fmt(d.upper, 1)}%` : ''}`,
    rule: (c) => `ETH 类抵押在同口径美元债务中的占比，对照自身近 ${c.windowDays} 日（至少 ${c.minObs} 个观测日）：中心 = 中位数，尺度 = 1.4826×MAD，带宽 = max(${c.k}×尺度, ${c.floor}pp)。连续 ${c.confirmDays} 个观测日在带外才算突破。` },
  { id: 'lltv-privilege', path: 'collateral', kind: 'gap', field: 'lltvGapPp',
    label: 'ETH 的折扣特权', question: '同样借美元，ETH 拿到的清算线比 BTC 更宽吗？',
    states: { positive: { label: 'ETH 更宽', tone: 'supportive', meaning: 'ETH 类抵押的债务加权清算线高于 BTC 类' },
      parity: { label: '持平', tone: 'neutral', meaning: 'ETH 类与 BTC 类抵押的债务加权清算线相同，ETH 没有折扣特权' },
      negative: { label: 'BTC 更宽', tone: 'adverse', meaning: 'BTC 类抵押的债务加权清算线高于 ETH 类' } },
    reading: (v) => `ETH − BTC = ${signed(v, 2)}pp`,
    rule: (c) => `同口径市场里 ETH 类与 BTC 类的债务加权 LLTV 之差。|差| ≤ ${c.tolerance}pp 视为持平，连续 ${c.confirmDays} 个观测日才换档。LLTV 是清算阈值，不是便利收益。` },
  { id: 'staking-flow', path: 'sinks', kind: 'trend', field: 'stakingRatioPct',
    label: '质押率方向', question: '被锁进共识层的 ETH 占比在升还是在降？',
    states: { rising: { label: '上升', tone: 'supportive', meaning: '有效质押占总供给的比例在上升' },
      flat: { label: '走平', tone: 'neutral', meaning: '有效质押占总供给的比例基本不变' },
      falling: { label: '下降', tone: 'adverse', meaning: '有效质押占总供给的比例在下降' }, accruing: ACCRUING },
    reading: (v, d) => `${fmt(v, 2)}%${d?.change != null ? `，${d.windowDays} 日 ${signed(d.change, 2)}pp` : ''}`,
    rule: (c) => `有效质押余额 ÷ 总供给，对比 ${c.windowDays} 日前。|变化| ≤ ${c.deadband}pp（该序列单日变动的 95 分位）视为走平，连续 ${c.confirmDays} 个观测日才换档。质押由收益驱动，上升不等于刚性需求。` },
  { id: 'treasury-flow', path: 'sinks', kind: 'trend', field: 'treasuryCohortEth', relative: true,
    label: '上市公司持仓方向', question: '最大的边际买家还在买吗？',
    states: { rising: { label: '增持', tone: 'supportive', meaning: '固定样本上市公司的 ETH 持仓在增加' },
      flat: { label: '走平', tone: 'neutral', meaning: '固定样本上市公司的 ETH 持仓基本不变' },
      falling: { label: '减持', tone: 'adverse', meaning: '固定样本上市公司的 ETH 持仓在减少' }, accruing: ACCRUING },
    reading: (v, d) => `${fmt(v / 1e6, 2)}M ETH${d?.change != null ? `，${d.windowDays} 日 ${signed(d.change, 2)}%` : ''}`,
    rule: (c) => `开始跟踪时持仓最大的 10 家上市公司（固定名单）的 ETH 合计，对比 ${c.windowDays} 日前。|变化| ≤ ${c.deadband}% 视为走平，连续 ${c.confirmDays} 个观测日才换档。来源是公司披露，有滞后；不含 ETF。` },
  { id: 'stable-majority', path: 'home', kind: 'line', field: 'stableStrictSharePct',
    label: '稳定币主场', question: '美元稳定币是否仍有一半以上落在以太坊体系？',
    above: 'majority', below: 'minority',
    states: { majority: { label: '过半', tone: 'supportive', meaning: '以太坊主网加严格口径 rollup 承载的美元稳定币过半' },
      minority: { label: '不足半数', tone: 'adverse', meaning: '以太坊主网加严格口径 rollup 承载的美元稳定币不足一半' } },
    reading: (v) => `严格口径 ${fmt(v, 1)}%`,
    rule: (c) => `主网与严格口径 rollup 的美元稳定币存量 ÷ 全链存量。${c.line}% 是"过半"这条结构线，连续 ${c.confirmDays} 个观测日越线才换档。份额不是 ETH 收入，也不是持有需求。` },
  { id: 'burn-line', path: 'fees', kind: 'line', field: 'burnOffsetPct',
    label: '费用路径', question: '销毁是否回到了值得一提的水平？',
    above: 'above', below: 'below',
    states: { above: { label: '高于参照线', tone: 'supportive', meaning: '30 日销毁抵消发行的比例高于参照线' },
      below: { label: '低于参照线', tone: 'neutral', meaning: '30 日销毁抵消发行的比例低于参照线，费用路径没有启动' } },
    reading: (v) => `销毁 ÷ 发行 = ${fmt(v, 1)}%`,
    rule: (c) => `30 日销毁 ÷ 同期总发行，100% 为打平。${c.line}% 是 Vitalik 在 2026-11-08 的帖子里自己给的"低于也不必介怀"参照线，不是本看板的目标值。连续 ${c.confirmDays} 个观测日越线才换档。` },
  { id: 'ethbtc-range', path: 'premium', kind: 'extreme', field: 'ethBtcRange',
    label: 'ETH/BTC 年度区间', question: '市场给 ETH 相对 BTC 的定价，有没有打破一年来的区间？',
    states: { at_high: { label: '365 日新高', tone: 'supportive', meaning: 'ETH/BTC 处在 365 日区间的新高' },
      in_range: { label: '区间内', tone: 'neutral', meaning: 'ETH/BTC 在 365 日区间之内' },
      at_low: { label: '365 日新低', tone: 'adverse', meaning: 'ETH/BTC 处在 365 日区间的新低' } },
    reading: (v, d) => `${fmt(v, 5)}${d?.positionPct != null ? `，区间位置 ${fmt(d.positionPct, 0)}%（低 ${fmt(d.low, 5)} / 高 ${fmt(d.high, 5)}）` : ''}`,
    rule: (c) => `实时 ETH/BTC 对照 365 个日度配对观测。区间极值出现在最近 ${c.episodeDays} 日内，即视为处于新低或新高；价格共振不等于储值溢价证据。` },
  { id: 'issuance-eip', path: 'policy', kind: 'category', field: 'issuanceEipStatus',
    label: '发行政策提案', question: '货币政策有没有再被摆上桌面？',
    states: {}, categoryTone: 'neutral',
    reading: (v) => `EIP-8363 状态：${v ?? '—'}`,
    rule: () => 'ethereum/EIPs 仓库里 EIP-8363（Tapered Issuance Burn）文件的 status 字段。任何变化都通知；状态是流程阶段，不是纳入升级的预测。' },
];
const BY_ID = Object.fromEntries(SIGNALS.map((s) => [s.id, s]));

export function stateInfo(def, state) {
  if (state == null) return { label: '无数据', tone: 'neutral', meaning: '尚无可用读数' };
  if (def.kind === 'category') return { label: String(state), tone: def.categoryTone, meaning: `提案状态为 ${state}` };
  return def.states[state] || { label: String(state), tone: 'neutral', meaning: '' };
}

// Readings a snapshot can supply right now. A group that is not `ok` supplies nothing.
export function readSnapshot(snapshot, asOf) {
  const a = snapshot?.auto || {};
  const ok = (key) => groupHealth(snapshot, key, asOf).status === 'ok';
  const number = (good, value) => good && finite(value) !== null ? { ok: true, v: value } : { ok: false };
  const usd = a.collateral?.usdDebtByCollateral;
  const range = a.ratio?.range365;
  return {
    ethToBtcDebtRatio: number(ok('usdDebt'), usd?.ethToBtcDebtRatio),
    usdDebtEthSharePct: number(ok('usdDebt'), usd?.ethSharePct),
    lltvGapPp: number(ok('usdDebt'), usd?.lltvGapPp),
    stakingRatioPct: number(ok('supply'), a.supply?.stakedEffectiveSharePct),
    burnOffsetPct: number(ok('supply'), a.supply?.burnOffsetPct),
    treasuryCohortEth: number(ok('treasuries'), a.treasuries?.cohortHoldingsEth),
    stableStrictSharePct: number(ok('stablecoins'), a.stablecoins?.ethAlignedSharePctStrict),
    ethBtcRange: ok('_market') && range?.status === 'observed' && finite(a.ratio?.now) !== null ? { ok: true, v: a.ratio.now, range } : { ok: false },
    issuanceEipStatus: ok('policy') && typeof a.policy?.issuanceEipStatus === 'string' ? { ok: true, v: a.policy.issuanceEipStatus } : { ok: false },
  };
}

function upsert(list, entry, maxDays) {
  const out = (list || []).filter((p) => p.d !== entry.d);
  out.push(entry);
  out.sort((x, y) => x.d.localeCompare(y.d));
  const floor = new Date(Date.parse(entry.d) - maxDays * DAY).toISOString().slice(0, 10);
  return out.filter((p) => p.d >= floor);
}

// Today's unconfirmed state for one signal, from today's reading and the daily series.
export function rawState(def, cfg, series, reading, day) {
  if (!reading?.ok) return { state: null };
  const value = reading.v, t = Date.parse(day);
  if (def.kind === 'line') return { state: value >= cfg.line ? def.above : def.below, value, detail: { line: cfg.line } };
  if (def.kind === 'gap') return { state: value > cfg.tolerance ? 'positive' : value < -cfg.tolerance ? 'negative' : 'parity', value, detail: { tolerance: cfg.tolerance } };
  if (def.kind === 'category') return { state: value, value, detail: null };
  if (def.kind === 'extreme') {
    const r = reading.range, detail = { low: r.low, high: r.high, positionPct: r.positionPct, daysSinceLow: r.daysSinceLow, daysSinceHigh: r.daysSinceHigh };
    const state = r.daysSinceLow <= cfg.episodeDays ? 'at_low' : r.daysSinceHigh <= cfg.episodeDays ? 'at_high' : 'in_range';
    return { state, value, detail };
  }
  const prior = (series || []).filter((p) => p.d < day);
  if (def.kind === 'band') {
    const window = prior.filter((p) => t - Date.parse(p.d) <= cfg.windowDays * DAY).map((p) => p.v);
    if (window.length < cfg.minObs) return { state: 'accruing', value, detail: { observations: window.length, minObs: cfg.minObs } };
    const center = median(window), scale = 1.4826 * median(window.map((v) => Math.abs(v - center)));
    const width = Math.max(cfg.k * scale, cfg.floor), lower = center - width, upper = center + width;
    return { state: value > upper ? 'breakout_up' : value < lower ? 'breakout_down' : 'in_range', value,
      detail: { center, scale, width, lower, upper, observations: window.length } };
  }
  if (def.kind === 'trend') {
    const target = t - cfg.windowDays * DAY;
    const ref = prior.filter((p) => Date.parse(p.d) <= target).at(-1);
    if (!ref || target - Date.parse(ref.d) > cfg.maxLagDays * DAY || (def.relative && !(ref.v > 0)))
      return { state: 'accruing', value, detail: { windowDays: cfg.windowDays } };
    const change = def.relative ? (value / ref.v - 1) * 100 : value - ref.v;
    return { state: change > cfg.deadband ? 'rising' : change < -cfg.deadband ? 'falling' : 'flat', value,
      detail: { change, windowDays: cfg.windowDays, reference: ref.v, referenceDay: ref.d } };
  }
  throw new Error(`Unknown signal kind: ${def.kind}`);
}

// One evaluation step. Pure: returns the next file and the state changes it produced.
export function advance(previous, readings, config, now) {
  const day = dayOf(now), maxDays = config.seriesMaxDays ?? 400;
  const prev = previous && previous.rulesVersion === RULES_VERSION ? previous : {};
  const series = { ...(prev.series || {}) }, raw = { ...(prev.raw || {}) }, signals = {}, changes = [];
  for (const [field, reading] of Object.entries(readings)) {
    if (reading?.ok && finite(reading.v) !== null) series[field] = upsert(series[field], { d: day, v: reading.v }, maxDays);
  }
  for (const def of SIGNALS) {
    const cfg = config.signals?.[def.id];
    if (!cfg) throw new Error(`Missing configuration for signal ${def.id}`);
    const before = prev.signals?.[def.id] || null;
    const today = rawState(def, cfg, series[def.field], readings[def.field], day);
    if (today.state === null) {
      signals[def.id] = { ...(before || { state: null, since: null, value: null, valueAt: null, detail: null }), dataOk: false, pending: null };
      continue;
    }
    raw[def.id] = upsert(raw[def.id], { d: day, s: today.state }, 60);
    // The trailing run of identical daily states ending today.
    const log = raw[def.id];
    let run = 0;
    for (let i = log.length - 1; i >= 0 && log[i].s === today.state; i--) run++;
    const runStart = log[log.length - run];
    const confirmWindow = log.slice(-cfg.confirmDays);
    const confirmed = run >= cfg.confirmDays && (Date.parse(day) - Date.parse(confirmWindow[0].d)) / DAY <= cfg.confirmDays + 1;
    let state = before?.state ?? null, since = before?.since ?? null;
    if (state === null) { state = today.state; since = runStart.d; }
    else if (today.state !== state && confirmed) {
      // Leaving the warm-up state is a first classification, not a crossing.
      changes.push({ t: now, id: def.id, from: state, to: today.state, value: today.value, notify: state !== 'accruing' && today.state !== 'accruing' });
      state = today.state; since = confirmWindow[0].d;
    }
    signals[def.id] = { state, since, value: today.value, valueAt: now, detail: today.detail ?? null, dataOk: true,
      pending: today.state !== state ? { state: today.state, days: run, needed: cfg.confirmDays } : null };
  }
  // Copied, not shared: a caller that later marks an event as pushed must not alter the previous file.
  const events = [...(prev.events || []).map((e) => ({ ...e })), ...changes.map((c) => ({ ...c, pushed: false }))].slice(-200);
  return { file: { rulesVersion: RULES_VERSION, updatedAt: now, push: prev.push || { channel: null, connectedAt: null, lastPushAt: null },
    signals, series, raw, events }, changes };
}

const TAGS = { supportive: ['white_check_mark'], adverse: ['warning'], neutral: ['information_source'] };
export function messageFor(change, file) {
  const def = BY_ID[change.id];
  const from = stateInfo(def, change.from), to = stateInfo(def, change.to), current = file.signals[change.id];
  return { title: `ETH 信号跨档｜${def.label}`, tags: TAGS[to.tone], priority: to.tone === 'neutral' ? 3 : 4,
    body: `${from.label} → ${to.label}。${def.reading(change.value, current?.detail)}。${to.meaning}。事实通知，不是交易指令。` };
}
export function connectMessage(file) {
  const lines = SIGNALS.map((def) => {
    const s = file.signals?.[def.id];
    return `${def.label}：${stateInfo(def, s?.state).label}`;
  });
  return { title: 'ETH 路径信号推送已接通', tags: ['bell'], priority: 3, body: `之后只有信号跨档才推送。当前状态——${lines.join('；')}。` };
}

// Rows for the page. Reads the stored file only; it never re-evaluates a rule.
export function describeSignals(file, config) {
  const usable = file && file.rulesVersion === RULES_VERSION;
  return { rulesVersion: RULES_VERSION, usable: !!usable, updatedAt: usable ? file.updatedAt : null, push: usable ? file.push?.channel ?? null : null,
    events: usable ? (file.events || []).filter((e) => e.notify).slice(-5).reverse().map((e) => {
      const def = BY_ID[e.id];
      return def ? { t: e.t, label: def.label, from: stateInfo(def, e.from).label, to: stateInfo(def, e.to).label, tone: stateInfo(def, e.to).tone } : null;
    }).filter(Boolean) : [],
    rows: SIGNALS.map((def) => {
      const s = usable ? file.signals?.[def.id] : null, info = stateInfo(def, s?.state ?? null), cfg = config?.signals?.[def.id] || {};
      return { id: def.id, path: def.path, pathLabel: PATHS[def.path], label: def.label, question: def.question,
        state: s?.state ?? null, stateLabel: info.label, tone: info.tone, toneLabel: TONES[info.tone], meaning: info.meaning,
        reading: s && finite(s.value) !== null || (s && typeof s.value === 'string') ? def.reading(s.value, s.detail) : '尚无可用读数',
        since: s?.since ?? null, valueAt: s?.valueAt ?? null, dataOk: s ? s.dataOk !== false : false,
        pending: s?.pending ? { label: stateInfo(def, s.pending.state).label, days: s.pending.days, needed: s.pending.needed } : null,
        rule: def.rule(cfg) };
    }) };
}
