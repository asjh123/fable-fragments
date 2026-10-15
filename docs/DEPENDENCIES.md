# 依赖与开源参考核查（2026-10-15）

本轮没有新增 npm 依赖，锁文件未因本轮功能改变。现有直接依赖：

| 依赖 | 固定版本 | 许可证 | 用途 |
|---|---:|---|---|
| React / React DOM | 19.3.0 | MIT | 界面 |
| Vite | 8.3.4 | MIT | TypeScript 与生产构建 |
| vite-plugin-pwa | 2.0.0 | MIT | Manifest、Service Worker |
| Dexie | 4.4.6 | Apache-2.0 | IndexedDB 离线数据 |
| supabase-js | 2.117.3 | MIT | 登录与远端同步 |
| Zod | 4.6.7 | MIT | 严格运行时校验 |
| Vitest | 5.0.4 | MIT | 单元/集成测试 |
| Playwright | 1.64.0 | Apache-2.0 | 手机/桌面浏览器测试 |
| fake-indexeddb | 6.2.5 | Apache-2.0 | IndexedDB 测试替身 |

## SQLite 选择

评估了官方 SQLite、`WiseLibs/better-sqlite3`、`simonw/sqlite-utils` 和 Datasette 的用途。当前运行环境 Node 24 已提供 `node:sqlite`、同步 API 和 FTS5，足以完成本机重建/搜索；因此没有安装 `better-sqlite3`，避免 Windows 原生预编译包、ABI/编译工具链和额外供应链成本。风险是 Node 文档仍将 `node:sqlite` 标为 active development，Node 升级时必须重跑内容测试。

PowerSync 项目只作为同步架构参考；按本阶段约束不引入 PowerSync、RxDB、PouchDB、CouchDB 或 Dexie Cloud。restic 只作为未来离线加密备份参考，本轮不安装、不执行。Supabase CLI 也未安装或连接真实项目。

参考的原始仓库：

- https://github.com/sqlite/sqlite
- https://github.com/WiseLibs/better-sqlite3
- https://github.com/colinhacks/zod
- https://github.com/supabase/cli
- https://github.com/simonw/sqlite-utils
- https://github.com/simonw/datasette
- https://github.com/restic/restic
- https://github.com/powersync-ja/powersync-js

自动审计结果见 `TEST_REPORT.md`。开源项目的 Star 数不是采用依据；本次优先考虑官方来源、许可证、现有锁定依赖、Windows/Node 兼容性与迁移成本，且没有下载或执行第三方仓库代码。
