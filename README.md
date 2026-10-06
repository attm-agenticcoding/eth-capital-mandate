# ETH 储值与抵押需求观察

一个公开、每 6 小时更新的研究看板。它把三个问题分开：

1. 谁必须持有 ETH？原生质押、有效安全资本与实际抵押融资分别测量
2. 谁实际付费？网络收费、销毁、发行、客户支付与补贴分别列示
3. 压力下能否被替代？在可比风险与融资条件下观察容量、成本和留存

生态采用放在辅助背景中。网络规模、TVL、相关性、单个市场最高 LLTV 不被加总为 SoV 分数，也不映射成价格概率或退出指令。

## 当前能回答与不能回答的内容

- 可观测：来源报告的价格、波动率、原生质押有效余额、供给变化、Ethereum L1 费用、稳定币分布
- 有限定的代理量：再质押协议 USD TVL、链上 TVL、Morpho 特定融资市场的债务加权 LLTV
- 明确未知：去重底层再质押 ETH、有效可罚没分配、AVS 真实客户净支付、补贴依赖、实际使用的 ETH 抵押品、可比融资便利收益、固定数量口径压力留存
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

`npm run fetch` 会请求真实公开接口并追加快照。导入 scripts/fetch.mjs 不会自动请求或写文件。程序化调用 `run({ write: false })` 可验证实时接口而不改历史。

回归测试覆盖空值与真实零、市场 403 全组恢复、样本缺失、未来时间、旧观察重复获取、日历持续性、费用目的地、方法版本、历史字节不变、完整快照组合和全源失败。原来的 39 项测试锁定已退休的评分语义；新测试检验数据意义与失效边界。

## 自动刷新与发布

GitHub Actions 仍在 main 推送、手动 dispatch 和每 6 小时执行。流程：安装 → 离线回归 / lint → 取数 → 验证快照 → 提交追加数据 → 构建 → GitHub Pages。

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

研究用途，不构成投资建议或交易指令。
