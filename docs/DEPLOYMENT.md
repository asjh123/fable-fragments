# GitHub Pages + Supabase 部署

线上地址：`https://asjh123.github.io/fable-fragments/`。工作流只在三个仓库 Secret 都存在时构建：

- `SUPABASE_URL`：项目 URL；
- `SUPABASE_PUBLISHABLE_KEY`：publishable 或旧版 anon key，不能使用 secret/service-role key；
- `OWNER_EMAIL`：Supabase 中已经创建的唯一用户邮箱。

仓库创建并推送后，GitHub Actions 会运行测试、重建 SQLite 校验、按 `/fable-fragments/` 子路径构建，并通过官方 Pages Actions 部署 `dist`。Secret 虽不会显示在仓库设置和日志中，但这些 `VITE_` 值最终会嵌入浏览器包；安全边界必须依赖 Auth 和 RLS，而不是隐藏前端变量。

Supabase 侧必须先完成：执行迁移、创建唯一用户、关闭公开注册、启用 Email，并把完整目标地址加入 Site URL 与 Redirect URLs。默认 Magic Link 只用于首次设置或找回同步密码；日常使用邮箱和密码登录。当前流程不会自动创建或修改真实 Supabase 项目。
