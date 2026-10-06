import { useEffect, useState } from 'react';

const STATUS = {
  observed: { label: '已观测', tone: 'green' },
  proxy: { label: '代理量', tone: 'blue' },
  unknown: { label: '待补数据', tone: 'neutral' },
  stale: { label: '过期', tone: 'amber' },
  invalid: { label: '口径异常', tone: 'red' },
  fresh: { label: '时效正常', tone: 'green' },
  ok: { label: '采集成功', tone: 'green' },
  healthy: { label: '采集成功', tone: 'green' },
  missing: { label: '待补数据', tone: 'neutral' },
  partial: { label: '部分可用', tone: 'amber' },
  unavailable: { label: '不可用', tone: 'neutral' },
  error: { label: '获取异常', tone: 'red' },
  failed: { label: '采集失败', tone: 'red' },
  legacy: { label: '旧版口径', tone: 'amber' },
  unverified: { label: '待核验', tone: 'amber' },
};

const SECTIONS = [
  { id: 'holding', short: '持有需求', title: '谁必须持有 ETH', en: 'HOLDING DEMAND', icon: 'hold', tone: 'green' },
  { id: 'fees', short: '实际付费', title: '谁实际付费', en: 'PAID SERVICES', icon: 'fee', tone: 'blue' },
  { id: 'stress', short: '压力下可替代性', title: '压力下能否被替代', en: 'STRESS & SUBSTITUTION', icon: 'stress', tone: 'amber' },
  { id: 'context', short: '生态背景', title: '生态背景', en: 'NETWORK CONTEXT', icon: 'context', tone: 'gray' },
];

function Icon({ name, size = 20, ...props }) {
  const paths = {
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    external: <><path d="M14 4h6v6M20 4l-9 9M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7h.01" /></>,
    hold: <><path d="M4 20h16M7 20V9h10v11M5 9l7-5 7 5M10 12v4M14 12v4" /></>,
    fee: <><path d="M4 7h16v13H4zM4 7V4h13v3M16 12h4v4h-4zM8 11h3M8 15h3" /></>,
    stress: <><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" /><path d="m8 12 3 3 5-6" /></>,
    context: <><circle cx="12" cy="12" r="3" /><circle cx="5" cy="5" r="2" /><circle cx="19" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" /><path d="m7 7 3 3m4 4 3 3m0-10-3 3m-4 4-3 3" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    book: <><path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14" /></>,
    quality: <><path d="M4 20V8m5 12V4m6 16v-8m5 8V6M2 20h20" /></>,
    chevron: <path d="m7 10 5 5 5-5" />,
    minus: <path d="M5 12h14" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.info}</svg>;
}

function EthMark({ className = '' }) {
  return <svg className={className} viewBox="0 0 40 64" fill="none" aria-hidden="true"><path d="m20 0 20 33-20 12L0 33 20 0Z" fill="currentColor" opacity=".9" /><path d="m20 0 20 33-20-9V0Z" fill="currentColor" opacity=".5" /><path d="m0 37 20 12 20-12-20 27L0 37Z" fill="currentColor" opacity=".7" /><path d="m20 24 20 9-20 12V24Z" fill="#142923" opacity=".5" /></svg>;
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() => (
    typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  ));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = theme === 'dark' ? '#0f1915' : '#f6f7f3';
    try {
      localStorage.setItem('eth-evidence-theme', theme);
    } catch { /* Theme switching still works when preferences cannot be saved. */ }
  }, [theme]);

  return <div className="theme-toggle" role="group" aria-label="看板配色模式">
    <button type="button" aria-label="切换为浅色模式" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>浅色</button>
    <button type="button" aria-label="切换为深色模式" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>深色</button>
  </div>;
}

function Badge({ status = 'unknown', label, className = '' }) {
  const info = STATUS[status] || STATUS.unknown;
  return <span className={`evidence-badge badge-${info.tone} ${className}`}><span className="badge-dot" />{label || info.label}</span>;
}

function formatTime(value, short = false) {
  if (!value) return '时间未提供';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '时间未提供';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    ...(!short ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
    timeZone: 'UTC',
  }).format(date).replaceAll('/', '-');
}

function valueDisplay(metric) {
  const { value, unit, precision } = metric;
  if (value == null || typeof value !== 'number' || !Number.isFinite(value) || ['unknown', 'invalid'].includes(metric.status)) return '—';
  const digits = Number.isFinite(precision) ? Math.max(0, Math.min(8, precision)) : (unit === 'count' ? 0 : unit === 'ratio' ? 3 : 1);
  if (unit === 'usd') {
    const abs = Math.abs(value);
    const divider = abs >= 1e9 ? 1e9 : abs >= 1e6 ? 1e6 : abs >= 1e3 ? 1e3 : 1;
    const suffix = divider === 1e9 ? 'B' : divider === 1e6 ? 'M' : divider === 1e3 ? 'K' : '';
    return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value / divider)}${suffix}`;
  }
  if (unit === 'eth' && Math.abs(value) >= 1e6) return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: Math.max(2, digits) }).format(value / 1e6)}M`;
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: unit === 'ratio' ? digits : 0 }).format(value)}${unit === 'pct' ? '%' : ''}`;
}

function sourceHref(source) {
  const url = source?.url;
  return typeof url === 'string' && /^https?:\/\//.test(url) ? url : null;
}

function SourceLink({ source, fallback = '来源未提供' }) {
  const url = sourceHref(source);
  if (!url) return <span className="source-missing">{source?.label || fallback}</span>;
  return <a className="source-link" href={url} target="_blank" rel="noreferrer noopener">{source.label || '查看数据源'}<Icon name="external" size={12} /></a>;
}

function MetricCard({ metric, showMethodology, isContext }) {
  const blank = metric.value == null || typeof metric.value !== 'number' || !Number.isFinite(metric.value) || ['unknown', 'invalid'].includes(metric.status);
  const unitLabels = { usd: 'USD', eth: 'ETH', count: '项', ratio: '比率' };
  return <article className={`metric-card ${blank ? 'metric-blank' : ''} ${isContext ? 'metric-context' : ''}`}>
    <div className="metric-topline"><h3>{metric.label}</h3><Badge status={metric.status} /></div>
    <div className="metric-reading"><span className="metric-number" title={!blank ? `${metric.value.toLocaleString('en-US')} ${metric.unit || ''}` : undefined}>{valueDisplay(metric)}</span>{!blank && unitLabels[metric.unit] && <span className="metric-unit">{unitLabels[metric.unit]}</span>}{blank && <span className="metric-blank-caption">{metric.status === 'invalid' ? '不作为有效读数' : '尚无有效测量'}</span>}</div>
    {metric.detail && <p className="metric-detail">{metric.detail}</p>}
    {metric.caveat && <div className="metric-caveat"><Icon name="info" size={14} /><span>{metric.caveat}</span></div>}
    <div className="metric-provenance"><div className="metric-time-block"><span className="metric-time"><Icon name="clock" size={12} />{metric.asOf ? `观测 ${formatTime(metric.asOf, true)}` : '观察时间未提供'}</span>{metric.fetchedAt && <span className="metric-fetch-time">采集 {formatTime(metric.fetchedAt)} UTC</span>}</div><SourceLink source={metric.source} /></div>
    {showMethodology && <div className="metric-method"><span className="method-label">口径与溯源</span><dl><div><dt>观测时点</dt><dd>{metric.asOf ? `${formatTime(metric.asOf)} UTC` : '观察时间未提供'}</dd></div><div><dt>本次采集</dt><dd>{formatTime(metric.fetchedAt)}</dd></div><div><dt>最近成功</dt><dd>{formatTime(metric.lastSuccessAt)}</dd></div><div><dt>证据类型</dt><dd>{STATUS[metric.status]?.label || '待补数据'}</dd></div>{metric.methodology && <div><dt>计算方法</dt><dd>{metric.methodology}</dd></div>}{metric.reason && <div><dt>限制原因</dt><dd>{metric.reason}</dd></div>}</dl><p>“已观测”表示该读数有数据支持，不代表已识别出 ETH 的储值溢价。</p></div>}
  </article>;
}

function ResearchSection({ section, index, showMethodology }) {
  const appearance = SECTIONS.find((item) => item.id === section.id) || SECTIONS[Math.min(index, 3)];
  const isContext = appearance.id === 'context';
  const gaps = section.gaps || [];
  return <section id={section.id || appearance.id} className={`research-section section-${appearance.tone} ${isContext ? 'context-section' : ''}`} aria-labelledby={`heading-${section.id || index}`}>
    <header className="section-heading"><div className="section-marker"><Icon name={appearance.icon} size={21} /></div><div className="section-title"><div className="section-eyebrow"><span>0{index + 1}</span>{appearance.en}{isContext && <span className="context-tag">背景参考</span>}</div><h2 id={`heading-${section.id || index}`}>{section.title || appearance.title}</h2></div><span className="section-line" /></header>
    <div className="section-intro">{section.question && <h3>{section.question}</h3>}{section.description && <p>{section.description}</p>}{isContext && <p className="context-boundary">链上资产规模和生态份额描述网络采用情况，不能直接推导 ETH 持有需求或储值溢价。</p>}</div>
    <div className={`metrics-grid ${(section.metrics || []).length === 2 ? 'metrics-grid-two' : ''}`}>
      {(section.metrics || []).map((metric) => <MetricCard key={metric.id || metric.label} metric={metric} showMethodology={showMethodology} isContext={isContext} />)}
    </div>
    {gaps.length > 0 && <div className="section-gaps"><div className="gaps-label"><span className="open-square" />证据缺口</div><div className="gap-list">{gaps.map((gap, i) => <div className="gap-item" key={`${gap.label}-${i}`}><div><strong>{gap.label}</strong>{gap.reason && <span>{gap.reason}</span>}</div>{showMethodology && gap.nextStep && <p><span>所需研究</span>{gap.nextStep}</p>}</div>)}</div></div>}
  </section>;
}

function issueText(issue) {
  if (typeof issue === 'string') return issue;
  return issue.detail || issue.message || issue.reason || issue.title || issue.label || '';
}

function DataQuality({ quality = {} }) {
  const [expanded, setExpanded] = useState(false);
  const groups = quality.groups || [];
  const issues = quality.issues || [];
  const needsAttention = groups.filter((group) => !group.observedAt || !['observed', 'fresh', 'ok', 'healthy'].includes(group.status)).length;
  const missingObservationTimes = groups.filter((group) => !group.observedAt).length;
  return <section id="data-quality" className="quality-panel" aria-labelledby="quality-title">
    <div className="quality-head"><div className="quality-title"><Icon name="quality" size={19} /><h2 id="quality-title">先检查数据，再阅读结论</h2></div><button className="text-button" type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls="source-quality-details">{expanded ? '收起来源状态' : '查看来源状态'}<Icon name="chevron" size={15} className={expanded ? 'rotate' : ''} /></button></div>
    <div className="quality-overview"><p>每个读数独立标注时效与口径。采集成功，也不代表观测时间是最新。</p><span className="quality-tally">{groups.length ? <><b>{groups.length}</b> 组数据来源<span className="quality-divider">/</span><b>{needsAttention}</b> 组需注意</> : '来源状态待补充'}</span></div>
    {missingObservationTimes > 0 && <p className="quality-time-warning"><Icon name="clock" size={13} />{missingObservationTimes} 组来源未记录上游观察时间，采集时间不能替代数据时点。</p>}
    {issues.length > 0 && <ul className="quality-issues">{issues.map((issue, i) => <li key={issue.id || i}><Icon name="info" size={14} /><span>{issueText(issue)}</span></li>)}</ul>}
    {expanded && <div id="source-quality-details" className="source-quality-grid">{groups.map((group) => <article className="source-quality-card" key={group.key || group.label}><div className="source-quality-head"><h3>{group.label}</h3><Badge status={group.status} /></div><dl><div><dt>数据观测</dt><dd>{group.observedAt ? formatTime(group.observedAt) : '观察时间未提供'}</dd></div><div><dt>本次采集</dt><dd>{formatTime(group.fetchedAt)}</dd></div><div><dt>最近成功</dt><dd>{formatTime(group.lastSuccessAt)}</dd></div></dl>{group.reason && <p>{group.reason}</p>}{group.source && <SourceLink source={group.source} />}</article>)}</div>}
  </section>;
}

function MarketContext({ market = {} }) {
  const items = [
    { label: 'ETH / USD', value: market.price, unit: 'usd', precision: 2 },
    { label: 'ETH / BTC', value: market.ethBtc, unit: 'ratio', precision: 5 },
    { label: '距历史高点回撤', value: market.drawdownPct, unit: 'pct', precision: 1 },
  ];
  if (items.every((item) => item.value == null)) return null;
  return <div className="market-context"><span className="market-label">市场背景</span>{items.map((item) => <div className="market-item" key={item.label}><span>{item.label}</span><strong>{valueDisplay(item)}</strong></div>)}<span className="market-disclaimer">价格共振 ≠ 储值溢价证据{market.observedAt ? <span>观测 {formatTime(market.observedAt)} UTC</span> : <span>观察时间未提供{market.fetchedAt ? ` · 采集 ${formatTime(market.fetchedAt)} UTC` : ''}</span>}</span></div>;
}

function Methodology({ evidence }) {
  const history = evidence.history || {};
  const diagnostics = evidence.diagnostics || [];
  return <section className="methodology-section" id="methodology" aria-labelledby="methodology-title"><div className="section-heading"><div className="section-marker"><Icon name="book" /></div><div className="section-title"><div className="section-eyebrow">READING THE EVIDENCE</div><h2 id="methodology-title">口径、边界与待完成研究</h2></div></div>
    <div className="methodology-columns"><div className="methodology-column"><h3>如何读这份看板</h3><ol className="reading-rules"><li><span>01</span><div><strong>观察具体需求，不合成总分</strong><p>持有、支付、抵押与结算是不同机制。单一读数不能替代因果识别。</p></div></li><li><span>02</span><div><strong>留空是研究状态，不是零</strong><p>缺数据、过期与口径异常分开标记；不将空值计入任何结论。</p></div></li><li><span>03</span><div><strong>比较对象必须可比</strong><p>价格同涨同跌、生态采用、名义抵押规模，都不能单独证明不可替代性。</p></div></li></ol><div className="history-notice"><Icon name="clock" size={17} /><div><strong>历史口径已分版</strong><p>旧版记录 {history.legacyCount ?? '—'} 条 · 当前口径 {history.currentCount ?? '—'} 条</p><p>{history.comparable ? '仅在经验证可比的口径内解释历史变化。' : '旧版与新版不直接拼接，不跨版本推断趋势。'}</p>{(history.breaks || []).length > 0 && <ul>{history.breaks.map((entry, i) => <li key={i}>{typeof entry === 'string' ? entry : entry.detail || entry.reason || entry.label}</li>)}</ul>}</div></div></div>
    <div className="methodology-column"><h3>术语速查</h3><dl className="glossary"><div><dt>LLTV <span>Liquidation Loan-to-Value</span></dt><dd>清算贷款价值比。达到该阈值可能触发清算；它不是实际借款比例，也不等于可以安全借入的比例。</dd></div><div><dt>ETH-equivalent <span>ETH 等值量</span></dt><dd>按 ETH 价格或相应兑换率换算的等值数量。美元规模除以 ETH 价格只是单位转换，不是原生 ETH 数量或净新增持有需求。</dd></div><div><dt>代理量 <span>Proxy</span></dt><dd>用于间接观察某一机制的量。需要额外假设，不能替代目标变量本身。</dd></div><div><dt>未知 <span>Unknown</span></dt><dd>缺少有效、同口径测量。以“—”展示，不等于 0，也不构成支持或否定结论。</dd></div></dl></div></div>
    {diagnostics.length > 0 && <details className="diagnostics"><summary><span>口径核验记录 <b>{diagnostics.length}</b></span><Icon name="chevron" size={17} /></summary><div>{diagnostics.map((diagnostic, i) => <article key={diagnostic.id || i}><span className={`diagnostic-dot ${diagnostic.severity === 'error' || diagnostic.severity === 'critical' ? 'diagnostic-error' : ''}`} /><div><h4>{diagnostic.title}</h4><p>{diagnostic.detail}</p></div></article>)}</div></details>}
    {(evidence.research || []).length > 0 && <div className="research-backlog"><div className="backlog-heading"><span className="section-eyebrow">RESEARCH BACKLOG</span><h3>还需要哪些证据</h3><p>以下为尚未完成的研究，不计入当前结论。</p></div><div className="backlog-items">{evidence.research.map((item, i) => <article key={item.id || item.title}><span>{String(i + 1).padStart(2, '0')}</span><div><h4>{item.title}</h4><p>{item.detail}</p></div><span className="backlog-state">待研究</span></article>)}</div></div>}
  </section>;
}

export function EvidenceDashboard({ evidence }) {
  const [showMethodology, setShowMethodology] = useState(false);
  const [activeSection, setActiveSection] = useState('holding');
  const sections = evidence.sections || [];
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActiveSection(visible[0].target.id);
    }, { rootMargin: '-110px 0px -65% 0px', threshold: 0 });
    SECTIONS.forEach(({ id }) => {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, []);
  const allMetrics = sections.flatMap((section) => section.metrics || []);
  const observedCount = allMetrics.filter((metric) => metric.status === 'observed' && Number.isFinite(metric.value)).length;
  const proxyCount = allMetrics.filter((metric) => metric.status === 'proxy' && Number.isFinite(metric.value)).length;
  const unknownCount = allMetrics.filter((metric) => metric.value == null || ['unknown', 'invalid'].includes(metric.status)).length;
  return <div className="evidence-app">
    <a href="#main-content" className="skip-link">跳到研究内容</a>
    <header className="site-header"><div className="header-inner"><a className="wordmark" href="#top" aria-label="ETH 研究观察首页"><EthMark /><span>ETH<span className="wordmark-divider" /><span className="wordmark-caption">研究观察</span></span></a><div className="header-note"><span className="live-dot" />证据优先 · 独立核验</div><a className="header-method-link" href="#methodology">阅读方法<Icon name="arrow" size={15} /></a></div></header>
    <section className="hero" id="top"><div className="hero-inner"><div className="hero-copy"><div className="hero-kicker"><span className="hero-kicker-line" />ETHEREUM RESEARCH MONITOR</div><h1>ETH 储值与<br className="desktop-break" />抵押需求观察<span className="heading-dot">.</span></h1><p className="hero-description">回到三个可检验的问题：谁需要持有，谁愿意付费，<br className="desktop-break" />以及压力来临时，谁仍然选择 ETH。</p><div className="hero-metadata"><span>证据框架 {evidence.version || 'v2'}</span><span className="metadata-divider" /><span>快照 {formatTime(evidence.generatedUtc)} UTC</span></div></div><aside className="identification-card" aria-label="当前研究识别状态"><div className="identification-top"><span>当前识别状态</span><Icon name="info" size={16} /></div><h2>未建立识别</h2><p>现有读数尚不足以单独识别<br />ETH 的储值溢价。</p><div className="identification-line" /><div className="evidence-inventory"><div><strong>{observedCount}</strong><span>项直接观测</span></div><div><strong>{proxyCount}</strong><span>项代理量</span></div><div><strong>{unknownCount}</strong><span>项待补 / 异常</span></div></div><div className="inventory-note">证据项数仅用于导航，不是评分或投资判断</div><EthMark className="hero-watermark" /></aside></div></section>
    <div className="navigation-shell"><nav className="section-navigation" aria-label="研究章节"><div className="section-links">{SECTIONS.map((section, index) => <a className={activeSection === section.id ? 'active' : ''} key={section.id} href={`#${sections[index]?.id || section.id}`} onClick={() => setActiveSection(section.id)}><span>0{index + 1}</span>{section.short}</a>)}</div><div className="navigation-controls"><ThemeToggle /><button className={`methodology-toggle ${showMethodology ? 'is-active' : ''}`} type="button" aria-pressed={showMethodology} onClick={() => setShowMethodology(!showMethodology)}><Icon name="book" size={16} /><span>显示口径</span><span className="toggle-track"><span /></span></button></div></nav></div>
    <main id="main-content" className="main-content"><MarketContext market={evidence.market} /><DataQuality quality={evidence.quality} /><div className="evidence-legend"><span>读数标记</span><Badge status="observed" /><Badge status="proxy" /><Badge status="unknown" /><Badge status="stale" /><Badge status="invalid" /><span className="legend-time">所有时间均为 UTC</span></div>
      {sections.map((section, index) => <ResearchSection key={section.id || index} section={section} index={index} showMethodology={showMethodology} />)}
      {!sections.length && <div className="empty-state"><Icon name="info" size={26} /><h2>暂无可用研究数据</h2><p>数据模型尚未提供有效章节。本页不会用旧版评分或默认值代替。</p></div>}
      <Methodology evidence={evidence} />
    </main>
    <footer className="site-footer"><div><a className="footer-brand" href="#top"><EthMark />ETH 研究观察</a><p>只呈现可追溯的证据，保留尚未回答的问题。</p></div><div className="footer-notes"><span>研究用途 · 非投资建议</span><span>不输出价格目标、成功概率或自动交易信号</span><a href="#top">回到顶部 ↑</a></div></footer>
  </div>;
}
