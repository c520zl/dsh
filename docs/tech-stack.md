# 技术栈版本锁定

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v1.0 |
| 锁定日期 | 2026-11-02（Asia/Shanghai） |
| 状态 | 版本基线；升级需走变更记录 |
| 上游文档 | [`todo-app-design.md`](todo-app-design.md)、[`requirements.md`](requirements.md) |
| 机器可读版本 | [`versions.json`](versions.json) |

> 本文件锁定的是**直接依赖**与运行时版本。客户端传递依赖由 `pnpm-lock.yaml` 固定，后端由 Maven Wrapper + `pom.xml` 固定；每次升级必须更新 `versions.json`、本文档和对应 lockfile。

## 1. 锁定原则

1. **精确版本**：`package.json` 只写 `X.Y.Z`，不使用 `^`/`~`/`latest`。
2. **lockfile**：客户端 pnpm workspace 使用 `--frozen-lockfile`；后端使用 Maven Wrapper 3.9.16 与 `pom.xml`。
3. **运行时锁定**：`.nvmrc`、`engines.node`、Docker 基础镜像、MySQL 镜像标签全部固定。
4. **兼容优先于最新**：以 Expo SDK 58、React Native 0.88、Spring Boot 3.5 的兼容矩阵为准；不追最新大版本。
5. **安全补丁例外**：高危漏洞可在 7 天内升级补丁版本，并记录原因与影响范围。
6. **大版本升级**：必须写 ADR，跑完整 E2E、真机矩阵与回滚演练。

## 2. 运行时与基础设施

| 组件 | 锁定版本 | 用途 | 备注 |
| --- | --- | --- | --- |
| JDK | 17.0.20 | API/Worker | LTS；Spring Boot 3 最低基线 |
| Maven | 3.9.16 | 后端构建 | 项目自带 Maven Wrapper |
| Spring Boot | 3.5.16 | API/Worker 框架 | 当前 3.5 稳定线 |
| MySQL | 8.0.46 | 主数据库 | utf8mb4_0900_ai_ci；PITR |
| Node.js | 24.22.2 LTS（Krypton） | 客户端工具链 | 与 RN 0.88 的 engines 兼容；Node 26.13.0 为下一升级候选 |
| pnpm | 12.16.1 | 客户端包管理 | `packageManager` 固定 |
| Docker 基础镜像 | `eclipse-temurin:17-jre` | API/Worker | 不使用浮动标签 |
| Nginx/CDN | 托管服务 | 反向代理/静态 | 版本由云厂商锁定 |
| Expo EAS | 托管 | 构建/提交 | 与 `eas-cli@27.2.0` 配套 |

**为什么不是 Node 26**：Node 26.13.0 已是 LTS，但 Expo SDK 58 / RN 0.88 当前的 CI 与原生工具链仍以 Node 24 验证最充分；Node 24 支持到 2028-04。升级到 Node 26 需在 Expo SDK 升级时一并验证。

## 3. 客户端（Expo / React Native）

| 包 | 锁定版本 | 用途 |
| --- | --- | --- |
| expo | 58.0.22 | Expo SDK 58 |
| react-native | 0.88.1 | 原生运行时 |
| react | 19.3.0 | UI |
| react-dom | 19.3.0 | Web/PWA 预留 |
| expo-router | 58.0.29 | 路由与深链 |
| expo-status-bar | 58.0.4 | 状态栏 |
| expo-sqlite | 58.0.15 | 本地数据库 |
| expo-secure-store | 58.0.2 | 令牌存储 |
| expo-notifications | 58.1.7 | 通知权限/本地补发 |
| expo-crypto | 58.0.7 | UUID/哈希 |
| expo-linking | 58.0.15 | 深链 |
| expo-localization | 58.0.5 | 语言/时区辅助 |
| expo-updates | 58.0.20 | OTA（仅 JS/资源） |
| zustand | 5.0.16 | 客户端状态 |
| @tanstack/react-query | 5.105.1 | 非同步数据请求 |
| drizzle-orm | 0.45.4 | SQLite ORM |
| react-hook-form | 7.91.0 | 表单 |
| zod | 4.6.7 | 校验（与服务端共享） |
| nativewind | 4.2.7 | Tailwind 风格样式 |
| tailwindcss | 3.4.19 | 样式引擎 |
| react-native-reanimated | 4.7.1 | 动画 |
| @shopify/flash-list | 2.3.3 | 长列表 |
| @sentry/react-native | 8.33.0 | 崩溃/性能 |
| @types/react | 19.3.0 | 类型 |

**兼容矩阵**

- Expo SDK 58 官方模板基线：React Native 0.88.1、React 19.3.0、TypeScript 6.0.3；
- `expo-router` 58.x 对应 SDK 58；
- `drizzle-orm` 的 `expo-sqlite` peer 要求 `>=14`，当前 58.0.15 满足；
- `nativewind@4.2.7` peer 要求 Tailwind `>3.3.0`，锁定 3.4.19（Tailwind 4 未在本版本验证）；
- Reanimated 4.7 需 RN 0.88 的新架构；Expo 58 默认新架构；
- Sentry RN 8.33 需 RN 0.88 / React 19.3。

**TypeScript 选型**

- 锁定 `typescript@6.0.3`（Expo SDK 58 模板使用的 6.0 系列）；
- 不直接采用 `typescript@7.0.2`：TS 7 为原生编译器大版本，Expo/Metro 与 ESLint 工具链尚未完成验证；待 Expo SDK 升级时评估。

## 4. 服务端（Spring Boot 3 / JDK 17 / MySQL 8）

| 包 | 锁定版本 | 用途 |
| --- | --- | --- |
| spring-boot-starter-web | 3.5.16 | REST / Fastify 替代 |
| spring-boot-starter-validation | 3.5.16 | Jakarta Validation |
| spring-boot-starter-security | 3.5.16 | 认证过滤器链 |
| mybatis-plus-spring-boot3-starter | 3.5.18.1 | MyBatis-Plus 与 XML Mapper |
| mysql-connector-j | Spring Boot 管理版本 | MySQL 驱动 |
| flyway-core / flyway-mysql | Spring Boot 管理版本 | 数据库迁移 |
| nimbus-jose-jwt | 10.10 | EdDSA JWT、OAuth JWKS |
| tink | 1.24.0 | Nimbus Ed25519 签名实现依赖 |
| lombok | Spring Boot 管理版本 | 实体/DTO 样板代码 |
| spring-boot-starter-test | Spring Boot 管理版本 | JUnit 5 / MockMvc |
| junit-jupiter / mockito | 随 starter | 单元/集成测试 |

**为什么 Spring Boot 3.5 而不是 4.x**

- 本项目锁定 JDK 17；Spring Boot 3.x 是当前经过 MyBatis-Plus 3.5 / Nimbus 10 验证的稳定组合；
- Spring Boot 4 需要重新验证 MyBatis-Plus、Spring Security 6 与测试工具链，不在本次版本基线内。

**为什么 MySQL 8**

- 按最新后端技术栈要求使用 MySQL 8.0.46；`DATETIME(3)` 统一存 UTC，`DATE` 存用户本地日历日期；
- 原 PostgreSQL 设计中的 schema 前缀映射为表名前缀；`citext/jsonb/timestamptz` 分别用
  `utf8mb4_0900_ai_ci`、`JSON`、`DATETIME(3)` 表达；
- 每用户同步序号通过 `sync_user_sync_state` 行锁串行化；OTP 与限流状态改存 MySQL。

## 5. Web 与管理端

| 包 | 锁定版本 | 用途 |
| --- | --- | --- |
| next | 16.4.3 | App Router |
| react / react-dom | 19.3.0 | UI |
| tailwindcss | 3.4.19 | 样式 |
| shadcn/ui | 按 CLI 生成时锁定 | 组件源码复制进仓库，不受 peer 漂移影响 |
| zod | 4.6.7 | 校验 |

Web 端 MVP 只做官网/管理后台；完整 Web 应用为 P2。

## 6. 工程与测试工具

| 包/工具 | 锁定版本 | 用途 |
| --- | --- | --- |
| typescript | 6.0.3 | 全仓 |
| eslint | 9.39.5 | 静态检查 |
| eslint-config-expo | 58.0.4 | Expo 规则 |
| prettier | 3.9.10 | 格式化 |
| turbo | 2.11.10 | Monorepo 任务编排 |
| vitest | 5.0.5 | 单元/集成测试 |
| JUnit 5 / MockMvc | 随 Spring Boot | 后端单元/集成测试（MySQL CI service） |
| supertest | 7.3.1 | API 测试 |
| fast-check | 4.10.2 | 同步属性测试 |
| @playwright/test | 1.64.1 | Web/E2E、文档截图 |
| @redocly/cli | 2.72.1 | OpenAPI 校验 |
| eas-cli | 27.2.0 | 移动端构建/提交 |

**为什么 ESLint 9 而不是 10**

- `eslint-config-expo@58.0.4` 与 `typescript-eslint@8.x` 当前以 ESLint 8/9 为验证基线；
- ESLint 10 发布较新，插件生态尚未完全跟进；锁定 9.39.5，待 Expo 配置升级。

## 7. 锁定与升级流程

### 7.1 仓库配置

根目录 `.npmrc`：

```ini
save-exact=true
engine-strict=true
auto-install-peers=true
```

根 `package.json`（示意，实际以仓库为准）：

```json
{
  "name": "todo-app",
  "private": true,
  "packageManager": "pnpm@12.16.1",
  "engines": {
    "node": "24.22.2"
  },
  "devDependencies": {
    "turbo": "2.11.10",
    "typescript": "6.0.3",
    "eslint": "9.39.5",
    "prettier": "3.9.10",
    "vitest": "5.0.5"
  }
}
```

`.nvmrc`：

```text
24.22.2
```

### 7.2 CI 规则

客户端：

```bash
corepack enable
corepack prepare pnpm@12.16.1 --activate
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test
```

后端：

```bash
cd backend
./mvnw -B test
./mvnw -B -DskipTests package
```

- Node 版本由 `.nvmrc` + `actions/setup-node` 固定；
- 依赖变更 PR 必须包含 lockfile；
- Renovate 只开 patch/minor PR，major 需要人工 ADR；
- 每月第一个工作日检查 patch，安全公告 7 天内处理。

### 7.3 升级检查表

- [ ] 阅读 release notes 与 breaking changes；
- [ ] 更新 `package.json` 精确版本 + `versions.json`；
- [ ] `pnpm install` 生成/更新 lockfile；
- [ ] 跑单元、集成、E2E、真机冒烟；
- [ ] 检查 Expo SDK / RN / React / TS 兼容矩阵；
- [ ] 检查 Docker 镜像、CI Node 版本、托管服务版本；
- [ ] 更新本文档并记录 ADR；
- [ ] staging 观察 48 小时后再上生产。

## 8. 基础设施与云服务

| 能力 | 选型 | 版本/规格锁定 |
| --- | --- | --- |
| 计算 | Fly.io / Render（海外）或阿里云/腾讯云（国内） | API 2 实例起，Worker 1–2 实例 |
| MySQL | 云数据库 MySQL / RDS / 阿里云 RDS | MySQL 8.0.46，PITR 7–14 天 |
| JDK | 托管构建/运行环境 | Temurin 17.0.20 |
| Maven | CI 缓存 | 3.9.16（项目自带 Maven Wrapper） |
| 对象存储 | Cloudflare R2 / 阿里云 OSS | S3 API；版本由服务端锁定 |
| 推送 | Expo Push / APNs / FCM / 国内厂商 | SDK 随 Expo 58 / 原生工程锁定 |
| 邮件 | Resend / SES | API 版本在适配器中固定 |
| 监控 | Sentry / Grafana Cloud / OpenTelemetry | SDK 版本见上表 |

## 9. 已知兼容风险

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| Expo SDK 58 与 React 19.3.1 patch | 官方模板锁 19.3.0 | 保持 19.3.0，等待 Expo 验证 |
| TypeScript 6 与部分 ESLint 插件 | 类型规则可能滞后 | 锁定 6.0.3；CI 跑 eslint 全量 |
| Spring Boot 4 / MyBatis-Plus | 兼容性未验证 | 锁定 Spring Boot 3.5.16；升级前跑全量集成测试 |
| Tailwind 4 与 NativeWind 4 | 未验证 | 锁 Tailwind 3.4.19 |
| MySQL 8.0 与 Flyway | 版本/排序规则差异 | 锁定 utf8mb4_0900_ai_ci；staging 先执行迁移 |
| Node 26 LTS | 生态验证不足 | 暂锁 Node 24.22.2，随 Expo 升级评估 |
| Nimbus Ed25519 / Tink | 缺少 Tink 时无法签名 | 锁定 tink 1.24.0；CI 覆盖登录链路 |

## 10. 版本来源与复核

- npm registry `latest` 查询时间：2026-11-01；
- Node 官方发布索引：<https://nodejs.org/dist/index.json>；
- MySQL 官方版本信息：<https://dev.mysql.com/doc/relnotes/mysql/8.0/en/>；
- Spring Boot 版本：<https://spring.io/projects/spring-boot>；
- MyBatis-Plus 版本：<https://baomidou.com/>；
- Expo SDK 58 发布说明：<https://expo.dev/changelog/sdk-58>；
- 复核命令：

```bash
node --version
pnpm --version
mysql --version
java -version
./backend/mvnw -version
pnpm outdated
```

> 版本锁定不是永久不变：每次升级都要更新 `versions.json`、本文档、lockfile 与 CI 镜像，并记录原因。
