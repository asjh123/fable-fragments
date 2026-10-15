# 第一阶段增量验证报告

验证日期：2026-10-15（Asia/Shanghai）  
环境：Windows、Node 24.18、npm 11.16

## 自动化结果

| 命令 | 结果 | 覆盖摘要 |
|---|---|---|
| `npm run test:all` | 通过 | 6 个 Vitest 文件 / 27 项；Node 内容工具 3 项 |
| `npm run content:check` | 通过 | 2 个母本版本、哈希、SQLite 原子重建 |
| `npm run content:search -- "贝叶斯"` | 通过 | 中文子串回退返回正确内容 |
| `npm run build` | 通过 | TypeScript、生产构建、PWA Manifest、SW；预缓存 9 项 |
| `VITE_BASE_PATH=/fable/; npm run build` | 通过 | GitHub Pages 式子路径构建 |
| `npm run test:e2e` | 通过 | Pixel 7 与桌面 Chromium 共 6 项 |
| `npm audit --json` | 通过 | 0 项已知漏洞（共 447 个依赖节点） |
| 敏感模式扫描 | 通过 | 源码/文档中未发现形似真实 OpenAI/Supabase JWT、service-role 环境变量；只有 `.env.example` |

## 已验证行为

- 严格内容 Schema、未知字段/危险 HTML 拒绝、备份导出重导入。
- 重复 `contentId+version`、发布内容静默修改、稳定哈希字段顺序、正文变化和时间字段规则。
- SQLite 全量重建、FTS5/中文回退检索、参数化查询。
- 上传幂等、唯一账号归属、复合游标、1001 条相同服务端时间、跨页失败恢复、空结果、无效远端事件不落库/不推进游标。
- 同步 Promise 互斥、上传成功但下载失败、新设备恢复内容/片段进度/答题/笔记并且无待上传事件。
- localhost、根域、GitHub Pages 子路径、尾部斜杠、非法 URL 和唯一邮箱限制。
- 手机/桌面完成片段、刷新续读、主题切换、揭晓前不泄题和离线应用壳。

## 尚未验证与说明

- 已于2026-10-15部署到 `https://asjh123.github.io/fable-fragments/`：HTTPS返回200，Manifest子路径正确，构建包含目标Supabase公开配置且不含`service_role`。
- 已在真实Supabase应用迁移、关闭公开注册、创建并确认唯一邮箱用户，并以匿名角色读取两条已发布内容。真实邮箱OTP/Magic Link和两台物理设备的事件往返仍需用户完成最后验收。
- 没有在真实 iOS/Android 上安装 PWA；移动浏览器尺寸和离线 Service Worker 已自动验证。
- 并行执行两个 Vite 构建时曾因共同写入 `dist` 触发 Windows `EBUSY`；改为串行后根路径与子路径均通过。这是验证命令竞争，不是产品运行故障。
- 当前 SVG PWA 图标需在正式发布前做真机兼容性验收。

真实云端测试步骤见 `SUPABASE_VERIFICATION.md`；完成前应用应保持“待配置/本地模式”表述。
