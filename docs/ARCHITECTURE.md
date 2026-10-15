# 架构

## 两条独立数据链

内容链：`Codex/人工生成 → content-library JSON母本 → SQLite派生索引 → 人工审核 → 发布器接口 → Supabase content_packs → PWA`。

学习链：`手机/电脑操作 → 本机 IndexedDB → Supabase learning_events → 另一设备 IndexedDB → 从事件重建进度`。

JSON 是内容权威来源；SQLite 仅用于电脑本地目录和检索，可随时删除重建。Supabase 是跨设备同步中转和已上传数据的云端副本，不替代独立备份。电脑不监听公网端口，也不是服务器。

## 不可变标识与合并

- 内容由 `content_id + version` 唯一标识；发布后修订必须升版本。
- 学习记录是追加事件；`user_id + event_id` 唯一，重复上传幂等。
- 片段完成取集合并集；答题和笔记保留历史；界面按事件时间选择最新笔记。
- 内容和事件先写本机，云端失败不删除本地记录。

## 存储职责

- `content-library/`：草稿、审核、发布、拒绝状态的母本及来源区。
- `local-data/catalog.sqlite`：由脚本生成的 `contents`、`sources`、`content_sources` 和 FTS5。
- IndexedDB：每个浏览器自己的内容缓存、学习事件、游标与同步状态。
- Supabase：公开已发布内容及唯一用户的学习事件；RLS 限制事件只能由所属用户读取/插入。

## 发布边界

`MemoryContentPublisher` 用于自动化测试。`SupabaseContentPublisher` 只提供接口骨架，重算哈希、拒绝覆盖；迁移没有给浏览器内容写策略，因此普通前端不能发布。未来发布工具应运行在受信任的本地/CI 环境，由用户明确确认，且服务端密钥不得进入前端包。
