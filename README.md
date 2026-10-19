# 微光 · 寓言碎片学习

本地优先的手机/电脑 PWA：把研究生水平概念拆成寓言片段，接近结尾再揭晓。一天内完成任意一次阅读、答题、查看解释或记录理解，即达成当天目标。

## 第一阶段增量版

- 单一预创建邮箱与同步密码登录；启动、登录、记录学习、网络恢复、回到前台、手动点击及页面可见时每 15 分钟触发同步。
- Dexie/IndexedDB 离线写入；Supabase 通过追加式事件、500 条分页和 `(created_at,event_id)` 复合游标中转。
- 界面区分上传/下载结果，显示待上传数、最后成功时间和最近错误。
- 新设备可从云端恢复已发布内容和已上传事件；未上传的数据不能恢复。
- `content-library/` 中的 JSON 是内容母本；`local-data/catalog.sqlite` 是可删除、可重建的检索索引。
- 已迁移“金属化薄膜电容自愈”和“贝叶斯更新”两份内容，保留原内容 ID 与版本。
- 发布器只有内存测试实现和 Supabase 安全骨架，不会自动发布，也没有真实云端写权限。
- 文章结尾支持“有收获 / 一般 / 差点意思”反馈；反馈与跳过操作先离线保存，再作为追加事件同步。
- 首页显示未读、完成和可选库存；未读少于 3 篇时只提醒补货，不会调用模型或自动生成。
- 偏好至少在 3 次同类有效反馈后才显示；“怀疑事实有误”只进入待复核，不代表已经判错。
- 设置页可导出脱敏反馈报告，不包含账号、令牌、设备标识和普通学习笔记。

## 运行

需要 Node.js 22.12+（本次验证使用 Node 24.18）。

```powershell
npm install
npm run dev
```

生产检查：

```powershell
npm run content:check
npm run test:all
npm run build
npm run test:e2e
npm run audit
```

## 内容库命令

```powershell
npm run content:validate
npm run content:index
npm run content:search -- "贝叶斯"
npm run content:check
```

SQLite 使用 Node 内置 `node:sqlite` 和 FTS5；连续中文词使用参数化子串回退。数据库文件已被 `.gitignore` 排除，不是内容来源。

## 配置跨设备同步

1. 创建自己的 Supabase 项目并按文件名顺序执行 `supabase/migrations/` 中的迁移；已有项目还需执行 `202610190003_feedback_events.sql`。
2. 在 Supabase Auth 中先创建唯一邮箱账号，关闭公开注册；新设备只允许登录已有账号。首次通过邮件链接进入已认证网页并设置同步密码。
3. 复制 `.env.example` 为 `.env`，填写公开 URL、publishable/anon key、唯一邮箱和完整部署 URL。
4. `VITE_PUBLIC_APP_URL` 必须包含部署子路径，例如 `https://用户名.github.io/仓库名/`。
5. Auth Redirect URLs 中加入同一完整 URL。默认 Magic Link 只用于首次设置或找回同步密码；日常登录调用 `signInWithPassword`，避免邮件内置浏览器与已安装 PWA 的会话隔离。
6. 只在浏览器放公开 key，绝不使用 `service_role`/secret key。

电脑不是服务器，手机和电脑无需同一局域网。两端都通过 HTTPS 站点与 Supabase 通信；电脑关闭不会阻止手机读取已上传的数据。

## 当前边界

- 默认没有真实凭据、未部署公网 HTTPS，也未执行真实邮箱、RLS 和两台物理设备验收；自动化仅用内存适配器验证。
- PWA 完全关闭后不承诺后台同步；重新打开或恢复前台后再同步。
- Supabase 免费项目可能暂停、限额或改变政策，不是永久保险箱；母本和学习记录都要另行备份并做恢复演练。
- 暂无自动 AI 生成、自动专利抓取、多人协作、多账号切换、自动发布或端到端加密。
- 当前偏好只根据反馈事件做阈值汇总，不声称已经完整理解用户；批量内容补货仍需后续实现。
- 不要写入公司机密、客户信息或未公开参数。

详见 [架构](docs/ARCHITECTURE.md)、[同步](docs/SYNC.md)、[内容库](docs/CONTENT_LIBRARY.md)、[部署](docs/DEPLOYMENT.md)、[备份恢复](docs/BACKUP_AND_RECOVERY.md)、[安全](docs/SECURITY.md) 和 [测试报告](docs/TEST_REPORT.md)。
