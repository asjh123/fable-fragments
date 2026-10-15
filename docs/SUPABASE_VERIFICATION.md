# Supabase配置与RLS复核

真实云端验证需要用户自己的Supabase项目，本仓库不包含凭据。

## 配置

1. 新建或选择明确的测试项目。
2. 执行`supabase/migrations/202610130001_initial.sql`。
3. 在Auth中预创建`VITE_OWNER_EMAIL`对应的唯一用户，并关闭公开注册；推荐配置Email OTP。
4. 将本地和包含仓库子路径的完整正式站点URL加入Redirect URLs，并把同一正式URL写入`VITE_PUBLIC_APP_URL`。
5. 仅把Project URL与anon/publishable key写入本机`.env`。
6. 不使用`service_role`启动前端。

## 两账户隔离验证

1. 用两个无敏感信息的测试邮箱分别注册账户A与账户B。
2. A登录后读一个片段并同步，在Table Editor确认该行`user_id`属于A。
3. A保持登录，用浏览器客户端查询`learning_events`；只能看到A的记录。
4. B登录另一浏览器，查询同表；不能看到A的记录。
5. B尝试通过普通客户端插入`user_id=A`的行；请求必须被RLS拒绝。
6. 匿名状态查询`learning_events`；必须返回空结果或权限错误。
7. A重复上传同一`event_id`；表中只能保留一行。
8. 检查浏览器Network和控制台：不得出现管理密钥、认证令牌日志或其他账户数据。

如果任何一步不满足，不得把云同步标记为已验证，也不得临时关闭RLS。

