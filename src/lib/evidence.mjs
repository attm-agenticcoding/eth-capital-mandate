// Evidence, not a calibrated SoV model. Pure functions accept an explicit as-of time.
export const SCHEMA_VERSION = 2;
export const METHODOLOGY_VERSION = 'eth-evidence-v2';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const finite = (v) => typeof v === 'number' && Number.isFinite(v) ? v : null;
const iso = (v) => {
  if (typeof v !== 'string' || !v) return null;
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!d) return null;
  const [, y, m, day] = d.map(Number);
  if (m < 1 || m > 12 || day < 1 || day > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  const time = /[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(v);
  if (time && (Number(time[1]) > 23 || Number(time[2]) > 59 || Number(time[3] || 0) > 59)) return null;
  return Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
};
const groups = {
  _market: ['价格与波动率', 'coingecko', 36],
  collateral: ['借贷市场代理数据', 'defillama_collateral', 48],
  morphoFinance: ['Morpho 融资子样本', 'collateral_morpho', 48],
  restaking: ['再质押协议 TVL', 'defillama_restaking', 48],
  supply: ['ETH 供给与原生质押', 'ultrasound', 48],
  fees: ['网络费用', 'growthepie', 96],
  stablecoins: ['稳定币分布', 'defillama_stables', 48],
  chains: ['链上 TVL 与交易量', 'defillama_chains', 48],
  rwa: ['旧 RWA 分类代理', 'defillama_rwa', 48],
  l2: ['L2 资产存量', 'l2beat', 48],
};
const source = {
  market: { label: 'CoinGecko', url: 'https://www.coingecko.com/en/coins/ethereum' },
  supply: { label: 'ultrasound.money', url: 'https://ultrasound.money/' },
  restaking: { label: 'DefiLlama Restaking', url: 'https://defillama.com/protocols/Restaking' },
  eigen: { label: 'EigenLayer allocation 定义', url: 'https://github.com/Layr-Labs/eigenlayer-contracts/blob/main/docs/core/AllocationManager.md' },
  morpho: { label: 'Morpho 市场与 LLTV', url: 'https://docs.morpho.org/learn/concepts/blue/' },
  aave: { label: 'Aave 抵押与债务', url: 'https://aave.com/docs/aave-v3/smart-contracts/pool' },
  fees: { label: 'growthepie', url: 'https://www.growthepie.com/' },
  stablecoins: { label: 'DefiLlama Stablecoins', url: 'https://defillama.com/stablecoins' },
  chains: { label: 'DefiLlama Chains', url: 'https://defillama.com/chains' },
  rwa: { label: 'DefiLlama RWA 方法', url: 'https://docs.llama.fi/real-world-assets/real-world-assets/methodology-and-metrics' },
};

export function groupHealth(snapshot, key, asOf = new Date().toISOString()) {
  const [label, sourceKey, defaultTtl] = groups[key] || [key, key, 48];
  const data = key === 'morphoFinance' ? snapshot?.auto?.collateral?.morphoFinance : snapshot?.auto?.[key];
  const native = data?.health || {};
  const origin = snapshot?.meta?.sources?.find((s) => s.key === sourceKey);
  const legacy = snapshot?.schemaVersion !== SCHEMA_VERSION;
  const fetchedAt = iso(native.fetchedAt || data?.fetchedAt || data?.asOf || origin?.fetchedAt || origin?.asOf);
  // Legacy `asOf` was the request time. Never relabel it as an observation.
  const observedAt = iso(native.observedAt || data?.observedAt);
  const lastSuccessAt = iso(native.lastSuccessAt || data?.lastSuccessAt || ((!native.status || native.status === 'ok') && origin?.ok !== false && !data?.stale ? fetchedAt : null));
  const ttlHours = finite(native.ttlHours) ?? defaultTtl;
  const now = Date.parse(asOf);
  let status = native.status || (data?.unavailable || !data ? 'failed' : data.stale || origin?.ok === false ? 'stale' : 'ok');
  let reason = native.reason || (legacy ? '旧版快照：asOf 是获取时间，上游观察时间未记录' : '');
  const badDeclaredTime = [native.observedAt, native.fetchedAt, native.lastSuccessAt, data?.observedAt].some((x) => x != null && x !== '' && !iso(x));
  if (badDeclaredTime) {
    status = 'invalid'; reason = '来源声明的时间戳无效，不能用获取时间替代';
  } else if (!Number.isFinite(now) || [observedAt, fetchedAt, lastSuccessAt].some((x) => x && Date.parse(x) > now)) {
    status = 'invalid'; reason = '时间戳晚于评估时点，不能作为当时可知证据';
  } else {
    const clock = observedAt || lastSuccessAt || fetchedAt;
    if (!clock && status === 'ok') { status = 'unknown'; reason = '缺少来源时间，无法确认新鲜度'; }
    else if (clock && now - Date.parse(clock) > ttlHours * HOUR && ['ok', 'partial'].includes(status)) {
      status = 'stale'; reason = `距最近有效时间已超过 ${ttlHours} 小时；保留末次值供核对`;
    }
  }
  if (data?.stale && status === 'ok') { status = 'stale'; reason = '整组沿用末次有效数据，不能由子字段 ok 覆盖'; }
  if (key === 'morphoFinance' && status !== 'invalid' && (snapshot?.auto?.collateral?.stale || snapshot?.auto?.collateral?.health?.status === 'stale')) {
    status = 'stale'; reason = '父数据组沿用旧样本，子字段不能自行恢复为新观测';
  }
  if (key === 'collateral' && data?.morphoOk === false && status === 'ok') {
    status = 'partial'; reason = 'Morpho 缺失，样本不完整，禁止按缩小后的分母作比较';
  }
  return { key, label, status, observedAt, fetchedAt, lastSuccessAt, ttlHours, reason,
    cohortId: native.cohortId || data?.cohortId || null, coverage: native.coverage || null };
}

export function detectHistoryBreaks(history = []) {
  const rows = history.filter((r) => iso(r?.t)).slice().sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1], row = rows[i];
    const a = finite(prev.rwaTotalUsd), b = finite(row.rwaTotalUsd);
    if (a !== null && a > 0 && b !== null && Math.abs(b / a - 1) > 0.3) {
      out.push({ id: `rwa-${row.t}`, date: row.t, field: 'rwaTotalUsd', changePct: (b / a - 1) * 100,
        title: 'RWA 序列口径断点待核对', detail: `${prev.t} 至 ${row.t} 的记录变化 ${((b / a - 1) * 100).toFixed(1)}%；不能直接解释为申购、赎回或市场迁移` });
    }
  }
  return out;
}

// Persistence is elapsed calendar time with fresh, distinct observations, not cron executions.
export function sustainedObservation(history, { field, predicate, days, asOf, maxGapDays = 2, methodologyVersion = METHODOLOGY_VERSION }) {
  const end = Date.parse(asOf), start = end - days * DAY;
  if (!Number.isFinite(end) || !(days > 0)) return { status: 'unknown', reason: 'invalid_window' };
  const byTime = new Map();
  for (const row of history || []) {
    if (row?.methodologyVersion !== methodologyVersion || row?.healthStatus !== 'ok') continue;
    const t = Date.parse(row.observedAt);
    if (!Number.isFinite(t) || t > end || finite(row[field]) === null) continue;
    byTime.set(t, row);
  }
  const rows = [...byTime].sort((a, b) => a[0] - b[0]);
  const before = rows.filter(([t]) => t <= start).at(-1);
  const within = rows.filter(([t]) => t > start);
  const sample = before ? [before, ...within] : within;
  if (!before || sample.length < 2 || start - before[0] > maxGapDays * DAY || end - sample.at(-1)[0] > maxGapDays * DAY)
    return { status: 'unknown', reason: 'insufficient_calendar_coverage' };
  if (sample.some(([t], i) => i && t - sample[i - 1][0] > maxGapDays * DAY)) return { status: 'unknown', reason: 'observation_gap' };
  return { status: sample.every(([, r]) => predicate(r[field])) ? 'met' : 'not_met', days, observations: sample.length };
}

// A sourced, dated episode can be reviewed; legacy raw USD share cannot establish substitution.
export function assessStressEpisode(episode, { asOf = new Date().toISOString() } = {}) {
  if (!iso(asOf)) return { status: 'unknown', reason: '评估时点无效' };
  if (!episode || !episode.id || !iso(episode.startedAt) || !iso(episode.endedAt) || !episode.source || !episode.methodologyVersion)
    return { status: 'unknown', reason: '需要有起止日期、来源和方法版本的完整压力事件' };
  if (Date.parse(episode.endedAt) > Date.parse(asOf) || Date.parse(episode.startedAt) >= Date.parse(episode.endedAt))
    return { status: 'unknown', reason: '事件尚未结束或日期无效' };
  if (episode.methodologyVersion !== METHODOLOGY_VERSION || episode.basis !== 'fixed-price-fixed-cohort')
    return { status: 'unknown', reason: '美元份额或旧版方法不能识别数量替代' };
  if (finite(episode.quantityShareDeltaPp) === null || typeof episode.eligibilityRetained !== 'boolean')
    return { status: 'unknown', reason: '缺少数量分解或抵押资格证据' };
  return { status: 'observed', quantityShareDeltaPp: episode.quantityShareDeltaPp,
    eligibilityRetained: episode.eligibilityRetained, reason: '事件事实已记录；不由固定阈值生成 SoV 通过或失败结论' };
}

export function buildEvidence(snapshot = {}, history = [], { asOf = new Date().toISOString() } = {}) {
  const auto = snapshot.auto || {};
  const hg = Object.fromEntries(Object.keys(groups).map((k) => [k, groupHealth(snapshot, k, asOf)]));
  const versioned = snapshot.schemaVersion === SCHEMA_VERSION && snapshot.methodologyVersion === METHODOLOGY_VERSION;
  const breaks = detectHistoryBreaks(history);
  const healthStatus = (key, base) => {
    const status = hg[key]?.status;
    return status === 'ok' ? base : status === 'stale' ? 'stale' : status === 'invalid' ? 'invalid' : 'unknown';
  };
  function metric({ id, label, value, unit, key, status = 'observed', precision = 1, src, detail, caveat = '' }) {
    const n = finite(value);
    const badRange = n !== null && ((['usd', 'eth', 'count'].includes(unit) && n < 0) || (['stable-strict-share', 'rwa-share', 'morpho-lltv', 'drawdown'].includes(id) && (n < 0 || n > 100)) || (id === 'btc-correlation' && Math.abs(n) > 1));
    if (badRange) status = 'invalid';
    const effective = status === 'invalid' ? 'invalid' : n === null ? 'unknown' : key ? healthStatus(key, status) : status;
    const h = hg[key];
    return { id, label, value: ['unknown', 'invalid'].includes(effective) ? null : n, unit, precision,
      status: effective, asOf: h?.observedAt || null, fetchedAt: h?.fetchedAt || null, lastSuccessAt: h?.lastSuccessAt || null,
      source: src || null, detail, caveat: [caveat, effective === 'stale' ? h?.reason : ''].filter(Boolean).join('；') };
  }
  const gap = (label, reason, nextStep) => ({ label, reason, nextStep });
  const s = auto.supply || {}, fees = auto.fees || {}, collateral = auto.collateral || {};
  const morpho = collateral.morphoFinance || {};
  const supply = finite(s.totalSupplyEth);
  const annualRate = (v) => finite(v) !== null && supply > 0 ? v * 365 / 30 / supply * 100 : null;
  const feesFresh = hg.fees.status === 'ok' && hg._market.status === 'ok';
  const feeMcap = versioned && feesFresh ? finite(fees.reportedL1FeesToMarketCapPctPerYr) : null;
  const rwaValidated = versioned && auto.rwa?.coverageValidated === true && auto.rwa?.health?.status === 'ok';
  const sections = [
    { id: 'holding', title: '谁必须持有 ETH', question: '持有是在提供不可替代的服务，还是只在追逐补贴？',
      description: '区分原生质押、底层资产、有效安全承诺与实际抵押融资。规模本身不等于需求强度。',
      metrics: [
        metric({ id: 'native-stake', label: '原生质押有效余额', value: s.stakedEffectiveEth, unit: 'eth', key: 'supply', precision: 0, src: source.supply,
          detail: '共识层有效质押余额，是可观察的 ETH 安全资本', caveat: '不等于第三方付费安全需求；奖励包含发行与风险补偿' }),
        metric({ id: 'restaking-tvl', label: '再质押协议 TVL', value: auto.restaking?.totalUsd, unit: 'usd', key: 'restaking', status: 'proxy', src: source.restaking,
          detail: 'EigenLayer / Symbiotic / Karak 的美元资产存量', caveat: '可能包含非 ETH 资产及重复底层敞口；不换算为真实 ETH 数量' }),
        metric({ id: 'underlying-eth', label: '去重后的再质押 ETH', value: versioned ? auto.restaking?.underlyingEth : null, unit: 'eth', key: 'restaking', precision: 0, src: source.eigen,
          detail: '需要逐资产数量、兑换率与跨协议底层去重', caveat: '美元 TVL ÷ ETH 价格不能替代该测量' }),
        metric({ id: 'slashable-eth', label: '有效可罚没 ETH 分配', value: versioned ? auto.restaking?.slashableEth : null, unit: 'eth', key: 'restaking', precision: 0, src: source.eigen,
          detail: '需要生效的服务分配、注册状态、罚没条件与去重', caveat: '入池、委托、分配和实际可罚没是不同状态' }),
        metric({ id: 'real-collateral', label: '支持实际非 ETH 债务的 ETH', value: null, unit: 'eth', src: source.aave,
          detail: '需要账户级抵押启用状态、债务和多抵押分配口径', caveat: 'Aave 池内余额不等于实际使用的抵押品' }),
      ], gaps: [gap('从资本供给走向真实需求', '目前不能判断多少资本在补贴结束后仍被付费服务需要', '接入服务分配、奖励来源、底层数量与 90 / 180 日留存')] },
    { id: 'fees', title: '谁实际付费', question: '有多少收入来自真实客户，最后归谁？',
      description: '网络手续费、销毁、发行、验证者收入与补贴分开看。任何一项都不单独等于持有人现金流。',
      metrics: [
        metric({ id: 'l1-fees', label: 'L1 手续费 / 日', value: fees.l1Fees30dAvgUsd, unit: 'usd', key: 'fees', precision: 0, src: source.fees,
          detail: '最近 30 日记录的日均手续费', caveat: '来源报告的 L1 执行费用，未包含 blob 费用；未扣运营成本，不是持有人利润' }),
        metric({ id: 'fees-mcap', label: '已报告 L1 费用 / ETH 市值', value: feeMcap, unit: 'pct', key: 'fees', precision: 3, src: source.fees,
          detail: 'growthepie 报告的 Ethereum 费用 30 日均值年化 / ETH 市值', caveat: '不另加跨 DA 的 blob costs；需有效时点匹配，不是股息率或目标估值' }),
        metric({ id: 'burn-rate', label: '销毁 / 总供给 · 年化', value: annualRate(s.burn30dEth), unit: 'pct', key: 'supply', precision: 3, src: source.supply,
          detail: '30 日 burn 年化后除以当前总供给', caveat: '销毁归属与验证者 tips / MEV 不同，不重复相加为股息' }),
        metric({ id: 'net-issuance', label: '净发行 / 总供给 · 年化', value: annualRate(s.net30dEth), unit: 'pct', key: 'supply', precision: 3, src: source.supply,
          detail: '30 日净供应变化年化，不是长期货币政策预测', caveat: '发行奖励不构成整个 ETH 持有人部门的外部新增现金流' }),
        metric({ id: 'avs-revenue', label: 'AVS 外部客户净支付', value: null, unit: 'usd', src: source.eigen,
          detail: '需将服务客户付款与 token 排放、积分、关联方补贴分离', caveat: '尚无经核对的覆盖完整数据，不能以 TVL 推算' }),
        metric({ id: 'subsidy-share', label: '安全服务补贴依赖率', value: null, unit: 'pct', src: source.eigen,
          detail: '需要统一会计边界下的客户收入与补贴来源', caveat: '缺数据不表示没有付费，也不表示有机需求已成立' }),
      ], gaps: [gap('资金归属与补贴剥离', '目前网络费用可读，第三方安全服务的外部净支付尚不可识别', '按真实付款方和收益归属建立收入账本，分别列示发行、手续费、补贴与成本')] },
    { id: 'stress', title: '压力下能否被替代', question: '在可比风险下，ETH 的融资服务是否仍有优势？',
      description: '价格跌幅只描述风险；抵押便利价值需要同负债、同期限、同风险条件下的可执行融资证据。',
      metrics: [
        metric({ id: 'drawdown', label: '距历史高点回撤', value: auto.eth?.drawdownFromPeakPct, unit: 'pct', key: '_market', src: source.market,
          detail: '相对 CoinGecko 报告的历史最高价', caveat: '不是一个已完成压力事件的通过 / 失败判定' }),
        metric({ id: 'rv365', label: '365 日实现波动率', value: auto.vol?.d365Pct, unit: 'pct', key: '_market', src: source.market,
          detail: '日对数收益的年化实现波动率', caveat: '不把两个 91 日波动率区间当作 RV365 连续半年达标' }),
        metric({ id: 'morpho-lltv', label: 'Morpho 债务加权 LLTV', value: versioned ? morpho.debtWeightedLltvPct : null, unit: 'pct', key: 'morphoFinance', status: 'proxy', src: source.morpho,
          detail: 'ETH 类抵押、美元稳定币负债且实际有借款的市场', caveat: '仅为该市场样本的清算阈值；不是 Aave LTV、整体 haircut 或便利收益' }),
        metric({ id: 'morpho-borrow', label: '上述市场实际借款', value: versioned ? morpho.totalBorrowUsd : null, unit: 'usd', key: 'morphoFinance', src: source.morpho,
          detail: '与 LLTV 完全相同市场样本的美元债务', caveat: '需固定样本与地址级资产核对；不能与其他协议池内余额混合' }),
        metric({ id: 'specialness', label: '可比抵押融资利差', value: null, unit: 'pct', src: source.morpho,
          detail: 'ETH 对 BTC / 稳定币 / tokenized Treasury 的匹配比较', caveat: '期限、利用率、清算、oracle、托管和法律风险必须控制' }),
        metric({ id: 'stress-retention', label: '压力事件数量留存', value: null, unit: 'pct', src: source.aave,
          detail: '固定资产价格与市场 cohort，区分净提款、清算及替代', caveat: '不使用旧美元份额或今天余额回填的历史生成结论' }),
      ], gaps: [gap('抵押品 specialness 研究', '当前无法分离抵押便利收益、风险溢价和补贴', '建立固定市场样本；围绕参数变化、补贴结束和压力事件比较融资容量、利差与实际损失')] },
    { id: 'context', title: '生态背景', question: '网络采用提供背景，但价值是否流向 ETH 仍需另证',
      description: '这些数据不能被加总成 SoV 分数。主网与 rollup、资产存量与交易流量分别标注。',
      metrics: [
        metric({ id: 'stable-total', label: '全链美元稳定币存量', value: auto.stablecoins?.totalUsd, unit: 'usd', key: 'stablecoins', src: source.stablecoins,
          detail: '按来源统计的流通美元稳定币', caveat: '存量不是支付交易额，也不是持有 ETH 的必要数量' }),
        metric({ id: 'stable-strict-share', label: 'Ethereum 严格口径稳定币份额', value: auto.stablecoins?.ethAlignedSharePctStrict, unit: 'pct', key: 'stablecoins', status: 'proxy', src: source.stablecoins,
          detail: '主网与所列 Ethereum 结算 / DA rollup 的存量份额', caveat: '固定分类清单需要持续核对；份额不是 ETH 收入' }),
        metric({ id: 'eth-mainnet-tvl', label: 'Ethereum 主网 DeFi TVL', value: auto.chains?.ethTvl, unit: 'usd', key: 'chains', status: 'proxy', src: source.chains,
          detail: '明确为主网，未与 Solana 比较时偷偷计入整个 L2 体系', caveat: '美元 TVL 受价格、借贷循环与统计覆盖影响' }),
        metric({ id: 'btc-correlation', label: 'ETH / BTC 收益相关性 · 90 日', value: auto.correlation?.now, unit: 'ratio', key: '_market', precision: 3, src: source.market,
          detail: '仅描述日收益共同波动', caveat: '高相关不等于没有货币溢价，低相关不等于 thesis 改善' }),
        metric({ id: 'rwa-share', label: '可比 RWA 份额', value: rwaValidated ? auto.rwa?.ethSharePct : null, unit: 'pct', key: 'rwa', status: rwaValidated ? 'proxy' : 'invalid', src: source.rwa,
          detail: '旧 category=RWA 协议 TVL 不代表完整 tokenized asset 市场', caveat: '历史出现 80.2% 总量断点；覆盖与分类未经核对，暂停份额解释' }),
      ], gaps: [gap('RWA 覆盖需重建', '旧序列不能区分发行、赎回、资产重估与重分类', '按资产 ID 选择 onchain / active marketcap 口径，保存纳入清单及申购赎回事件')] },
  ];
  const qualityIssues = Object.values(hg).filter((h) => h.status !== 'ok').map((h) => `${h.label}：${h.reason || h.status}`);
  const diagnostics = [
    { id: 'identification', title: '尚未建立 SoV 的因果识别', severity: 'info', detail: '当前展示事实、代理量和缺口。移除未经校准的总分、价格概率与“几票退出”规则。缺数据不被解释为支持或反对。' },
    { id: 'collateral-definition', title: '旧抵押品份额停用', severity: 'warning', detail: 'Aave 池内余额、Morpho 抵押净额与 Sky 余额口径不同；不再混成真实抵押品，也不再回填 Morpho 历史。' },
    ...breaks.map((b) => ({ ...b, severity: 'warning' })),
  ];
  if (!versioned) diagnostics.push({ id: 'legacy-snapshot', title: '当前原始快照来自旧版取数', severity: 'warning', detail: '旧概率与打分仅保留在历史记录中，页面不使用。旧 asOf 只代表获取时间；新语义需要下一次成功刷新。' });
  const legacyCount = history.filter((r) => r?.methodologyVersion !== METHODOLOGY_VERSION).length;
  const currentCount = history.length - legacyCount;
  return { version: METHODOLOGY_VERSION, generatedUtc: snapshot.generatedUtc || null, evaluatedAt: asOf,
    reviewStatus: '数据不足以识别 ETH 的储值溢价', quality: { groups: Object.values(hg), issues: qualityIssues }, sections, diagnostics,
    history: { legacyCount, currentCount, breaks, comparable: false,
      note: '旧记录原样保留；方法版本之间不拼接总分或抵押份额，不据此回测新框架。' },
    research: [
      { title: '底层 ETH 与有效承诺', detail: '逐资产数量与兑换率、跨协议去重、有效罚没分配；存量与服务需求分开。' },
      { title: '真实付款与补贴', detail: '匹配付款方、服务与受益人，剥离发行和激励，观察补贴结束后的留存。' },
      { title: '可比融资条款', detail: '固定 debt asset、期限与市场，比较 ETH / BTC / 稳定币 / tokenized Treasury；不把 funding basis 直接命名为便利收益。' },
      { title: '压力与基础完整性', detail: '事件窗口、清算滑点、坏账、提款时间；另看验证者 / 客户端 / 托管集中度、最终性与货币政策变更。' },
      { title: '独立估值研究', detail: '服务价值与投资回报分别建模；先定义终值还是首次触及，再讨论价格分布，不从观察指标机械生成概率。' },
    ],
    market: { price: hg._market.status === 'ok' ? finite(auto.eth?.price) : null,
      ethBtc: hg._market.status === 'ok' ? finite(auto.ratio?.now) : null,
      drawdownPct: hg._market.status === 'ok' ? finite(auto.eth?.drawdownFromPeakPct) : null,
      status: hg._market.status, observedAt: hg._market.observedAt, fetchedAt: hg._market.fetchedAt },
  };
}
