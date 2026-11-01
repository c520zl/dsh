# Todo App 后端（@todo/api）

NestJS 11 + Fastify + PostgreSQL 18 + Redis 8 的待办事项 API 与 Worker。
接口契约以 [`docs/api/openapi.yaml`](../../docs/api/openapi.yaml) 为准，数据模型以
[`docs/sql/001_init.sql`](../../docs/sql/001_init.sql) 为基线。

## 已实现范围

| 模块         | 状态  | 说明                                                                          |
| ------------ | ----- | ----------------------------------------------------------------------------- |
| Auth         | ✅    | 邮箱验证码、Apple/Google ID Token、Ed25519 JWT、刷新令牌轮换与重放撤销        |
| Me / Devices | ✅    | 资料、设置、设备与推送 token、账号注销（30 天后物理清理）                     |
| Lists        | ✅    | 收件箱、CRUD、归档、排序、删除时移动/删除任务                                 |
| Tasks        | ✅    | CRUD、子任务、完成/撤销、批量、排序、视图、搜索、回收站                       |
| Tags         | ✅    | P1 标签 CRUD 与任务关联（删除标签自动解除关联）                               |
| Sync         | ✅    | snapshot、push（opId 幂等、savepoint、字段级冲突合并）、pull、localDeliveries |
| Reminders    | ✅    | 提醒物化、DB 原子领取、Expo/日志推送、24 小时补发与重试                       |
| Export       | ✅    | JSON/CSV 异步导出、24 小时本地下载（可替换为对象存储签名 URL）                |
| Attachments  | ⏳ P1 | 接口与对象存储适配留待下一阶段                                                |
| Stats        | ⏳ P2 | OpenAPI 中为 P2                                                               |

## 目录

```
src/
  main.ts / worker.ts       API 与 Worker 两个入口（同一代码库，分开部署）
  core/                     配置、数据库、Redis、鉴权、限流、审计、提醒、导出、清理
  modules/                  auth / me / devices / lists / tasks / tags / sync / export
  domain/                   UUIDv7、时区与 DST、RRULE 子集、occurrenceKey、sortRank
  db/                       Drizzle schema 映射与迁移执行器
test/
  unit/                     纯函数测试（时区、RRULE、排序键、UUID）
  integration/              真实 PostgreSQL + Redis 的 API/同步/提醒/导出测试
```

同步写入路径：REST 写接口与 `/v1/sync/push` 共用同一套事务内写入方法
（`*InTx`），因此 REST 与移动端 Outbox 走完全相同的校验、版本递增、变更日志和提醒重建逻辑。

## 本地运行

前置：Node 24.22.2、pnpm 12.16.1、PostgreSQL 18（测试可用 16）、Redis 8（测试可用 7）。

```bash
# 仓库根目录
pnpm install
cp apps/api/.env.example apps/api/.env
# 按需修改 DATABASE_URL / REDIS_URL / AUTH_JWT_* 等
```

准备数据库（示例使用本地 `todo` 角色与 `todo_dev` 库）：

```bash
createdb -O todo todo_dev
pnpm db:migrate
```

启动 API 与 Worker（两个终端）：

```bash
pnpm dev          # API: http://127.0.0.1:3000/v1
pnpm worker       # 或 pnpm worker:dev
```

健康检查：`GET /v1/health`。

开发环境未配置 `AUTH_JWT_PRIVATE_KEY`/`AUTH_JWT_PUBLIC_KEY` 时会生成一次性 Ed25519
密钥对，重启后旧访问令牌失效。生产环境必须配置 base64 编码的 PEM 密钥，否则拒绝启动。
生成命令见 `apps/api/.env.example` 注释。

本地未配置 `MAIL_DRIVER=resend` 时验证码只写入服务端日志（不进入生产）。登录：
请求验证码后从日志/邮件取得 6 位码，再调用 `/v1/auth/otp/verify`。测试中通过注入的
FakeMailer 获取验证码，不依赖日志。

## 测试

测试默认连接：

- PostgreSQL：`postgres://todo:todo@127.0.0.1:5432/todo_test`
- Redis DB 15：`redis://127.0.0.1:6379/15`

可通过 `TEST_DATABASE_URL` / `TEST_REDIS_URL` 覆盖。测试会 **删除并重建** 测试库中的
`identity/todo/notify/sync/ops` schema（库名必须以 `_test` 结尾），并清空 Redis DB 15。

```bash
pnpm typecheck
pnpm lint
pnpm test           # 60 个测试：单元 + 集成
pnpm test:unit
pnpm test:integration
```

集成测试覆盖：OTP/刷新令牌重放/设备撤销、清单与任务视图、If-Match、完成撤销、回收站、
批量操作、标签解除关联、时区“今天”、同步幂等/字段冲突合并/重复提醒上报、重复任务推进/
结束/撤销、提醒物化与分发、JSON/CSV 导出与越权下载。

## 配置

完整配置项见 [`apps/api/.env.example`](.env.example)。生产环境必须显式设置：

- `DATABASE_URL`、`REDIS_URL`
- `AUTH_JWT_PRIVATE_KEY`、`AUTH_JWT_PUBLIC_KEY`（Ed25519 PKCS#8/SPKI PEM 的 base64）
- `MAIL_DRIVER=resend` 与 `RESEND_API_KEY`（或替换为自有邮件适配器）
- 如需真实推送：`PUSH_ENABLED=true` 与 `PUSH_DRIVER=expo`；其它厂商通道按 `PushService` 接口扩展

## 关键设计说明

- **时区**：`due_date` 为用户本地日历日期，不做时区换算；`due_at` 为 UTC。全天提醒
  使用用户当前时区 + `defaultReminderTime`；RRULE 按任务的 `recurrenceTimeZone` 墙钟展开。
  DST 春季跳变顺延到下一个有效墙钟，秋季回拨取较早（第一次）的 UTC 瞬间。
- **重复任务**：完成当前实例写 `todo.task_completions`（`(taskId, occurrenceKey)` 唯一），
  推进到期、`recurrence_seq`、剩余次数；次数/截止日期用尽写 `completed_at` 结束系列。
  补完成较早实例时跳过中间实例，直到下一次不早于当前时间。撤销按 `completionId` 恢复快照；
  “5 秒内可撤销”是客户端交互约束，服务端允许撤销最近一次完成，以兼容离线 complete +
  uncomplete 同时到达的场景。
- **同步**：`sync.user_sync_state.current_seq` 每用户递增；push 在单个事务内使用
  `pg_advisory_xact_lock` 串行化，每条 op 使用 savepoint 独立失败；`baseVersion` 落后时
  从 `change_log` 计算字段交集，冲突字段保留服务端值并返回 `conflict`。
- **提醒**：`notify.reminders` 的 `reminder_key` 对应 `reminderSpec.id`；客户端
  `localDeliveries` 按 `reminder_key + occurrenceKey` 标记已送达，避免离线补发重复。
- **删除**：任务/清单/标签均为软删除；任务删除级联子任务墓碑；清单删除默认把任务移回收件箱，
  也可选择连同任务进入回收站；30 天后 Worker 物理清理。
- **安全**：所有查询带 `user_id`，复合外键保证跨租户引用失败；JWT 每次请求回源校验用户/设备
  `auth_version`，设备移除/注销后下一次请求立即失效；日志脱敏 access token/cookie。

## 已知限制 / 下一阶段

- 附件（P1）与统计（P2）尚未实现；`/v1/attachments/*`、`/v1/stats/summary` 当前返回 404。
- 导出下载使用本地磁盘适配器与额外 `GET /v1/export/{id}/download` 路由；生产应替换为
  对象存储预签名 URL（`ExportService` 已隔离文件生成与下载读取）。
- 邮件仅实现日志与 Resend 适配器；推送仅实现 Expo 与日志适配器，国内厂商通道待接入。
- 提醒调度使用 PostgreSQL `FOR UPDATE SKIP LOCKED` 原子领取（与设计文档 §3.8 一致），
  未引入 BullMQ；MVP 量级下无需额外队列。
- 清单名称唯一性由数据库部分唯一索引 + 应用校验双重保证；并发创建同名清单会返回 400。
