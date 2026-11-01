# Todo App 后端（Spring Boot 3）

Spring Boot 3 + JDK 17 + MySQL 8 + Maven 3.9 + MyBatis-Plus（XML Mapper）实现的待办事项 API 与后台任务。
接口契约以 [`docs/api/openapi.yaml`](../docs/api/openapi.yaml) 为准；本实现是当前仓库的后端基线。

## 技术栈

| 组件 | 版本 | 用途 |
| --- | --- | --- |
| JDK | 17.0.20 | 运行时与构建 |
| Spring Boot | 3.5.16 | Web、Validation、Security、Scheduling |
| Maven | 3.9.16 | 构建（含 Maven Wrapper） |
| MySQL | 8.0.46 | 主数据库 |
| MyBatis-Plus | 3.5.18.1 | 数据访问；复杂 SQL 全部在 `mapper/*.xml` |
| Flyway | Spring Boot 管理版本 | 数据库迁移 |
| Nimbus JOSE + Tink | 10.10 / 1.24.0 | Ed25519 访问令牌与 Apple/Google JWKS 校验 |
| Lombok | Spring Boot 管理版本 | 实体/DTO 样板代码 |

## 已实现范围

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| Auth | ✅ | 邮箱 OTP、Apple/Google ID Token、Ed25519 JWT、刷新令牌轮换/重放撤销 |
| Me / Devices | ✅ | 资料、设置、设备/推送 token、账号注销（30 天后清理） |
| Lists | ✅ | 收件箱、CRUD、归档、排序、删除时移动/删除任务 |
| Tasks | ✅ | CRUD、子任务、完成/撤销、批量、排序、视图、搜索、回收站 |
| Tags | ✅ | 标签 CRUD 与任务关联（删除标签自动解除关联） |
| Sync | ✅ | snapshot、push（opId 幂等、nested savepoint、字段级冲突合并）、pull、localDeliveries |
| Reminders | ✅ | 提醒物化、`FOR UPDATE SKIP LOCKED` 原子领取、Expo/日志推送、24 小时补发与重试 |
| Export | ✅ | JSON/CSV 异步导出、24 小时下载 |
| Idempotency | ✅ | `Idempotency-Key` 持久化到 MySQL，重试返回相同结果 |
| Attachments / Stats | ⏳ | P1/P2，未注册接口 |

REST 写入与 `/v1/sync/push` 共用同一套 `@Transactional` service 方法；同步 push 在单事务内用
MySQL `SELECT ... FOR UPDATE` 串行化每用户序号，并为每条 op 使用 savepoint 隔离失败。

## 目录

```
src/main/java/com/todoapp/
  auth/ me/ device/ list/ task/ tag/ sync/ reminder/ export/ worker/
  common/     错误结构、请求 ID、限流、UUIDv7、时区/DST、RRULE 子集、游标
  config/     配置属性、Spring Security、Web 配置
  mapper/     MyBatis Mapper 接口
src/main/resources/
  application.yml
  db/migration/V1__init.sql, V2__idempotency.sql
  mapper/*.xml
src/test/java/com/todoapp/
  support/    Spring Boot + MockMvc 测试基类、Fake Mailer/OAuth
  *Test.java  认证、任务、同步、重复任务/提醒/导出、领域单测
```

## 本地运行

前置：JDK 17、MySQL 8、Maven 3.9（项目自带 `mvnw`）。

```bash
# 1. 创建数据库与账号（示例）
mysql -u root -p <<'SQL'
CREATE DATABASE todo_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE todo_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'todo'@'%' IDENTIFIED BY 'todo';
GRANT ALL PRIVILEGES ON todo_dev.* TO 'todo'@'%';
GRANT ALL PRIVILEGES ON todo_test.* TO 'todo'@'%';
SQL

# 2. 启动（Flyway 自动建表）
cd backend
DATABASE_URL='jdbc:mysql://127.0.0.1:3306/todo_dev?useUnicode=true&characterEncoding=utf8&serverTimezone=UTC&useSSL=false&allowPublicKeyRetrieval=true' \
DATABASE_USERNAME=todo DATABASE_PASSWORD=todo \
./mvnw spring-boot:run
```

健康检查：`GET http://127.0.0.1:3000/v1/health`。

复制 `backend/.env.example` 为本地环境变量参考；开发环境未配置 `AUTH_JWT_PRIVATE_KEY`/`AUTH_JWT_PUBLIC_KEY` 时会生成一次性 Ed25519 密钥对，
重启后旧访问令牌失效；生产环境应配置 base64 编码的 PEM 私钥/公钥（见配置表）。

### 配置

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | 3000 | HTTP 端口 |
| `DATABASE_URL` | `jdbc:mysql://127.0.0.1:3306/todo_dev?...` | JDBC URL，必须 `serverTimezone=UTC` |
| `DATABASE_USERNAME` / `DATABASE_PASSWORD` | todo / todo | 数据库账号 |
| `AUTH_JWT_PRIVATE_KEY` / `AUTH_JWT_PUBLIC_KEY` | 空 | Ed25519 PEM 的 base64；为空时仅开发/测试可使用 |
| `JWT_ISSUER` / `JWT_AUDIENCE` | todo-api / todo-app | JWT iss/aud |
| `GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID` | 空 | OAuth audience |
| `MAIL_DRIVER` | log | `log`（开发）或 `resend` |
| `RESEND_API_KEY` | 空 | `MAIL_DRIVER=resend` 时必填 |
| `PUSH_ENABLED` / `PUSH_DRIVER` | false / log | `expo` 时调用 Expo Push |
| `STORAGE_DIR` | ./storage | 导出文件目录 |
| `PUBLIC_BASE_URL` | http://127.0.0.1:3000 | 导出下载 URL 前缀 |
| `RATE_LIMIT_PER_MINUTE` / `SYNC_RATE_LIMIT_PER_MINUTE` | 120 / 20 | 单实例内存固定窗口 |
| `WORKER_ENABLED` | true | 关闭后不运行提醒/导出/清理调度 |
| `REMINDER_TICK_MS` / `EXPORT_TICK_MS` / `CLEANUP_TICK_MS` | 5000 / 5000 / 3600000 | Worker 调度间隔 |

完整变量见 `src/main/resources/application.yml`。

## 测试

测试使用真实 MySQL `todo_test`（默认 `jdbc:mysql://127.0.0.1:3306/todo_test...`，账号 todo/todo），
测试上下文启动时由 Flyway clean + migrate 重置 schema。`app.worker.enabled=false` 避免后台调度干扰。

```bash
cd backend
./mvnw test
```

当前 28 个测试：认证/刷新令牌重放、设备、清单/任务/视图/If-Match/回收站、标签、同步幂等与
字段冲突合并、重复任务推进/结束/撤销、提醒物化/分发、JSON 导出、领域时区/RRULE/游标测试。

## 关键设计说明

- **MySQL 表名**：原 PostgreSQL schema 映射为表名前缀（`identity_*`、`todo_*`、`notify_*`、`sync_*`、`ops_*`），
  以便在单库内表达原 schema；ID 使用 `CHAR(36)` 存储应用生成的 UUIDv7。
- **时间**：JDBC 统一 `serverTimezone=UTC`；`DATETIME(3)` 存 UTC，`DATE` 存用户本地日历日期；
  全天提醒使用用户时区与默认提醒时间；RRULE/DST 由 `common.Recurrence` / `common.TimeUtils` 统一处理。
- **同步序号**：`sync_user_sync_state` 行锁 + `UPDATE current_seq`；push 在一个事务内获取用户锁，
  `nestedTransactionTemplate` 为每条 op 建立 savepoint。`sync_processed_ops` 缓存逐条结果。
- **完成/撤销**：`todo_task_completions` 以 `(task_id, occurrence_key)` 唯一，记录撤销所需旧值；
  “5 秒内撤销”作为客户端交互约束，服务端允许按 `completionId` 撤销最近一次完成，以兼容离线
  complete+uncomplete 同时到达。
- **OTP 与限流**：不需要 Redis；OTP 哈希、验证码尝试次数、按邮箱/IP 的小时限额均保存在 MySQL。
  HTTP 限流为单实例内存固定窗口（多实例部署时应替换为 Redis/网关限流）。
- **Worker**：Spring `@Scheduled` 轮询；生产只需一个实例开启 `WORKER_ENABLED`，API 实例可关闭。
- **导出**：本地磁盘生成文件，额外提供 `GET /v1/export/{exportId}/download`（OpenAPI 已补充）；
  生产可替换为对象存储预签名 URL。

## 已知限制

- 附件（P1）与统计（P2）未实现，对应路径返回 404。
- OAuth 远端 JWKS 校验未在自动化测试中联网覆盖；测试通过注入 Verifier 覆盖业务路径。
- 邮件/推送仅提供日志、Resend、Expo 适配器；国内厂商通道待接入。
- HTTP 限流是单实例内存实现，不是分布式限流。
- `OtpVerifyRequest` 没有 `deviceId`，登录按 `(name, platform, appVersion, osVersion)` 复用设备；
  App 版本升级会新增设备记录。
- 导出下载以本地文件实现，不包含附件二进制（P1）。
