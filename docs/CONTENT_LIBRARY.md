# 内容母本与本地索引

## 目录和状态

- `content-library/drafts`：生成后、未审核。
- `content-library/reviewed`：已人工审核、未发布。
- `content-library/published`：已发布不可静默覆盖；修改正文必须新版本。
- `content-library/rejected`：拒绝内容。
- `content-library/sources`：允许保存公开来源材料，但不会自动发布。

当前母本采用严格 JSON。Zod `contentPackSchema` 是唯一可执行 Schema；`schemas/README.md` 只解释位置，避免维护第二套规则。汽车薄膜电容/专利字段支持公开号、原始 URL、检索日期、事实断言、推论和暗喻映射。

## 校验与哈希

`npm run content:validate` 检查未知字段、危险 HTML、来源、状态目录及重复 `contentId+version`。已发布内容还必须有审核/发布时间并通过 SHA-256。

稳定哈希会递归排序对象键，排除 `contentHash`、`reviewedAt`、`publishedAt`、`updatedAt`；生成时间和正文属于内容，会参与哈希。绝对路径不参与，所以不同电脑结果一致。

## SQLite

`npm run content:index` 从全部母本原子重建 `local-data/catalog.sqlite`，不修改母本。选择 Node 22.5+ 内置 `node:sqlite`，避免为当前单机工具增加 `better-sqlite3` 原生二进制、编译链和升级成本。代价是 API 仍标记为 active development，升级 Node 时需要回归。

`npm run content:search -- "关键词"` 使用参数化查询。FTS5 处理可分词文本；内置 `unicode61` 对连续中文切词有限，因此无结果时使用转义后的参数化 `LIKE` 子串回退。脚本不启动网络服务。

`npm run content:check` 同时验证格式、发布哈希和索引重建。发布内容若被直接改动而不更新版本/哈希会失败；不能仅改写哈希来替代版本治理，评审流程仍必须检查变更。

## 反馈与后续补货

阅读反馈不写入内容母本，而是保存在追加式学习事件中。设置页可以导出脱敏反馈报告，供后续批量生成或人工选题参考。本阶段没有接入模型 API，也不会自动创建草稿。

“待复核”只说明最新反馈包含“怀疑事实有误”，不构成事实错误结论。需要修订已发布内容时必须创建更高版本，不能覆盖现有 JSON 或只改哈希。
