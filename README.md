# ETH 储值与抵押需求观察

一个公开、每 6 小时更新的研究看板。它把三个问题分开：

1. 谁必须持有 ETH？原生质押、有效安全资本与实际抵押融资分别测量
2. 谁实际付费？网络收费、销毁、发行、客户支付与补贴分别列示
3. 压力下能否被替代？在可比风险与融资条件下观察容量、成本和留存

生态采用放在辅助背景中。网络规模、TVL、相关性、单个市场最高 LLTV 不被加总为 SoV 分数，也不映射成价格概率或退出指令。

页面顶部另有一层**路径信号**：九条规则各盯一个可观测读数，跨档时推送到手机。它们回答的是同一个问题的不同环节——链上金融变大，会不会变成对 ETH 的持有需求。详见下文“路径信号与推送”和 [docs/signals-v1.md](docs/signals-v1.md)。

## 当前能回答与不能回答的内容

- 可观测：来源报告的价格、波动率、原生质押有效余额与质押率、供给变化、销毁对发行的抵消比例、Ethereum L1 费用、稳定币分布、ETH/BTC 在 365 日区间的位置、Morpho 美元稳定币债务按抵押品类别的拆分
- 有限定的代理量：再质押协议 USD TVL、链上 TVL、Morpho 特定融资市场的债务加权 LLTV 及 ETH 与 BTC 两类之差、上市公司披露的 ETH 持仓
- 明确未知（列在各章节“证据缺口”，不占指标卡片）：去重底层再质押 ETH、有效可罚没分配、AVS 真实客户净支付、补贴依赖、跨协议实际使用的 ETH 抵押品、可比融资便利收益、固定数量口径压力留存、现货 ETF 持仓与验证者队列
- 口径异常待核对：旧 RWA 分类序列；历史 2026-09-15 的总量下降约 80.2% 不能直接解释为赎回或迁移

“已观测”仅指数据可读，不表示储值命题已得到确认。数字为空不代表零。未建立因果识别，也没有经验证的价格预测模型。

## 数据契约 v2

最新快照包含 `schemaVersion: 2`、`methodologyVersion: "eth-evidence-v2"`。每个 auto 数据组有 health：

- status：ok / stale / partial / failed；页面另外区分 unknown 与 invalid
- observedAt：来源实际提供的观察时间；缺少时保持 null
- fetchedAt：本次请求时间，绝不替代 observedAt
- lastSuccessAt：最近成功采集时间
- ttlHours、reason、cohortId、coverage：时效、限制和样本覆盖

旧快照的 asOf 只是请求时间，页面明确标注，不追溯伪造观察时间。页面载入时重新检查时效；全组 stale 不会被内部旧 ok 字段覆盖。

### 保守的口径处理

- CoinGecko 失败会从 previous.auto 恢复 eth/btc/ratio/vol/correlation 全组末次数据，并标 stale
- Aave / Morpho / Sky 只保留分场所代理数据，不混成“真实净抵押品份额”，也不把当前 Morpho 余额回填历史
- 部分场所或协议缺失，不能默默缩小分母；有同口径完整前值则冻结并标旧，否则整体留空
- 再质押 USD TVL 不是底层 ETH 数量；即使能换算 ETH-equivalent，也不作为真实安全需求
- Morpho LLTV 使用实际有借款的 ETH 类抵押 / 明确 USD 稳定币负债市场，并按债务加权；不是 Aave haircut
- 波动率使用每日 UTC 价格；RV365 持续性需要真实观察时间、日历覆盖和相同方法版本，不按 cron 条数判断
- 费用比率使用来源报告的 Ethereum 费用 / ETH 市值。growthepie 通用 costs_blobs 可能包含非 Ethereum DA；不将它们加总成 ETH 收入
- L2 → L1 仅在有收款目的地明确的租金指标时计算；不能把通用 all-DA costs 当成 Ethereum 收入
- RWA USD stock 变化不是 gross issuance；分类、样本及大额断点必须先核对
- 缺项、过期、错误与不利事实分开，任何一种都不触发自动 SoV 或交易判定
- Morpho 每个市场只有一种抵押品和一种贷出资产，所以“美元稳定币债务由哪类抵押品支持”在该场所内精确归属；任一市场缺借款余额则整组留空。它不是全市场份额，Aave 这类资金池做不到同样的归属
- 稳定币分母的成员变动：新增的链直接接受；消失的链只有在末次余额已知且不超过前值总量 0.05% 时才接受，否则仍然留空待核对；没有余额记录可查的，人工核对后把末次余额和出处写进 `REVIEWED_STABLECOIN_DROPS`
- 上市公司持仓的方向只看固定名单（开始跟踪时最大的 10 家）；数据源新增一家公司不算买入，名单成员缺失则该合计留空

## 路径信号与推送

每条信号只读一个字段，状态只在跨档时变化。没有总分，没有概率，“支持 / 不利”只就该环节而言。

| 环节 | 信号 | 读数 | 换档规则 |
|---|---|---|---|
| 抵押品 | 美元信贷的首选抵押品 | Morpho 美元债务：ETH 类 ÷ BTC 类 | 跨过 1 |
| 抵押品 | ETH 抵押份额的走向 | 同口径 ETH 类占比 | 走出自身 90 日中位数 ± max(3×1.4826×MAD, 0.6pp) |
| 抵押品 | ETH 的折扣特权 | ETH − BTC 债务加权 LLTV | 超出 ±0.5pp |
| 锁仓 | 质押率方向 | 有效质押 ÷ 总供给 | 30 日变化超出 ±0.05pp |
| 锁仓 | 上市公司持仓方向 | 固定 10 家合计 | 30 日变化超出 ±0.1% |
| 主场 | 稳定币主场 | 严格口径份额 | 跨过 50% |
| 费用 | 费用路径 | 30 日销毁 ÷ 发行 | 跨过 10% |
| 相对强弱 | ETH/BTC 年度区间 | 实时比值对照 365 个日度观测 | 创 365 日新低或新高 |
| 货币政策 | 发行政策提案 | EIP-8363 的 status 字段 | 任何变化 |

- 换档需要连续 3 个不同的观测日（年度区间与提案状态为 1 个）。同一天多次运行只算一次，中间断档会重新计数
- 读数缺失、过期或所属数据组不是 ok 时，状态沿用并在页面标出，不换档
- 全部参数在 `config/signals.json`；每个数字的来历写在 [docs/signals-v1.md](docs/signals-v1.md)
- 状态存在 `data/signals.json`，随数据一起提交。初始状态由 `scripts/seed-signals.mjs` 用仓库存档的逐次快照重算得到，不回写 `data/history.*`

### 接通推送（ntfy）

1. 手机装 ntfy，订阅一个只有自己知道的频道名
2. `gh secret set NTFY_TOPIC --body "<频道名>" -R attm-agenticcoding/eth-capital-mandate`
3. 下一次刷新会先推一条“ETH 路径信号推送已接通”，并列出当前各信号状态

没设这个 secret 时照常评估和记录，只是不推送。频道名等于密码，只放在 GitHub secret 里。推送失败的跨档会在之后 72 小时内的运行中重试。GitHub 的 schedule 触发不保证准点，所以推送延迟以小时计；这些都是慢变量，按日确认。

## 历史保留与版本边界

`data/history.ndjson` 保持追加写入；旧记录字节不清洗、不改分、不回填。`data/history.json` 在闭合数组前追加新行，不重新序列化旧记录。旧记录没有版本字段，页面明确归为 legacy。

旧分数和先验留在历史记录与 Git 历史中供审计；当前代码不消费它们。旧、新方法不拼接趋势，不据此做新框架回测。`data/manual.json` 的旧操作员记录保留，不再作为自动打分依据。

样本成员变动会留下 cohortReviewRequired。调查真正的新增、退出或 API 故障之后，才应在一次可审计的方法变更中更新纳入清单和 cohort ID；不要通过删除历史或重置前值来消除警告。

## 开发与验证

```sh
npm ci
npm run selfcheck
npm run lint
npm run build
npm run dev
```

`npm run fetch` 会请求真实公开接口并追加快照。导入 scripts/fetch.mjs 不会自动请求或写文件。`npm run fetch:dry` 请求实时接口、打印每个来源的状态，不写任何文件；`npm run signals:dry` 评估信号但不推送、不写文件。

Pull request 由 `.github/workflows/ci.yml` 检查：离线回归、lint、构建，再做一次实时取数的 dry run，改动取数逻辑时能在合并前看到真实接口的反应。

回归测试覆盖空值与真实零、市场 403 全组恢复、样本缺失、未来时间、旧观察重复获取、日历持续性、费用目的地、方法版本、历史字节不变、完整快照组合和全源失败。原来的 39 项测试锁定已退休的评分语义；新测试检验数据意义与失效边界。

## 自动刷新与发布

GitHub Actions 仍在 main 推送、手动 dispatch 和每 6 小时执行。流程：安装 → 离线回归 / lint → 取数 → 验证快照 → 评估路径信号并推送跨档 → 提交追加数据 → 构建 → GitHub Pages。

信号评估出错不会拦住数据刷新和发布：数据照常提交、页面照常更新，另有一个 `signals-status` 任务把这次运行标红。

源故障优先保留可追溯的末次值与明确状态。全源失败会让刷新任务失败；已发布页面仍按 TTL 显示旧值风险，不伪装为新观测。

## 下一阶段研究

- 逐资产 underlying 数量、兑换率和跨协议去重
- 服务分配、客户收入与补贴账本
- 固定 debt asset、期限、利用率、oracle / 法律 / 托管风险下的 ETH、BTC、稳定币和 tokenized Treasury 比较
- 参数变动、补贴结束和压力事件的固定 cohort 研究
- 验证者、客户端和托管集中度；最终性、罚没与货币政策完整性
- 独立的估值情景、假设和敏感性；先定义终值或首次触及，不能从代理量机械生成概率

这些研究尚未完成。现有看板为它们保留清晰缺口，不以主观分值替代数据。

## 参考

- [Aave 抵押与借款](https://aave.com/docs/aave-v3/smart-contracts/pool)
- [Morpho 市场、LLTV 与不可变参数](https://docs.morpho.org/learn/concepts/blue/)
- [EigenLayer 有效分配](https://github.com/Layr-Labs/eigenlayer-contracts/blob/main/docs/core/AllocationManager.md)
- [DefiLlama RWA 口径](https://docs.llama.fi/real-world-assets/real-world-assets/methodology-and-metrics)
- [growthepie 数据代码](https://github.com/growthepie/gtp-backend)
- [重构说明](docs/reconstruction-v2.md)
- [路径信号规则与参数来历](docs/signals-v1.md)

研究用途，不构成投资建议或交易指令。
