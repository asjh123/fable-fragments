# 单账号同步

## 触发与状态

同步在启动已有会话、登录、新学习事件、`online`、页面重新可见、手动点击时触发；页面可见时每 15 分钟补偿一次。同一 IndexedDB 实例使用 Promise 互斥，重叠调用复用同一任务。PWA 完全关闭后无法保证后台运行。

界面显示：正在同步、云端已同步、离线使用中或同步失败，并列出待上传数、最后成功时间（Asia/Shanghai）和最近错误。上传成功、下载失败会显示部分失败；已确认上传的事件不会改回失败。

## 复合游标

每页最多 500 条，按 `created_at ASC,event_id ASC` 排序。下一页条件为：

```text
created_at > cursor.createdAt
OR (created_at = cursor.createdAt AND event_id > cursor.eventId)
```

每页先校验事件 Schema，再在同一 Dexie 事务写事件和游标。返回不足一页或 `hasMore=false` 时结束；最多 200 页，游标不前进也会停止。旧版单字符串游标被安全忽略并重新拉取，事件 ID 去重避免重复计数。

## 新手机恢复

1. 打开同一 HTTPS 部署站点。
2. 使用 Supabase 中预创建的同一邮箱登录。
3. 应用拉取全部已发布内容和全部已上传学习事件。
4. 进度、答题和笔记由事件重建；设置页应显示待上传 0 条。

只能恢复已成功上传的数据。旧手机仍离线或本机记录未同步时，云端不存在的部分无法在新手机恢复。

## 单账号不是安全边界

`VITE_OWNER_EMAIL` 只是前端限制，而且构建变量对浏览器可见。真正边界是 Supabase 中只预创建一个账号、关闭公开注册，以及 `auth.uid() = user_id` 的 RLS。当前自动测试使用内存适配器；真实 Supabase 验收按 `SUPABASE_VERIFICATION.md` 执行。
