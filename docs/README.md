# Todo App 设计文档索引

本目录是待办事项管理 App 的设计与工程基线，按“从产品到实现”的顺序组织。

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [`todo-app-design.md`](todo-app-design.md) | 系统设计方案：业务功能、架构、同步、技术选型、实施计划 | v1.0（已合并） |
| [`requirements.md`](requirements.md) | 详细需求：规则、边界、用户故事、验收场景、发布门槛 | v1.0 |
| [`api/openapi.yaml`](api/openapi.yaml) | REST 与同步 API 规范（OpenAPI 3.0.3） | v1.0 |
| [`database.md`](database.md) | 数据库字段、约束、索引、事务与保留策略 | v1.0 |
| [`sql/001_init.sql`](sql/001_init.sql) | PostgreSQL 设计基线 DDL（历史参考） | v1.0 |
| [`sql/001_init.mysql.sql`](sql/001_init.mysql.sql) | MySQL 8 初始化 DDL（当前 Spring Boot 实现） | v1.0 |
| [`../backend/README.md`](../backend/README.md) | Spring Boot 后端实现、运行与测试说明 | v1.0 |
| [`tech-stack.md`](tech-stack.md) | 锁定版本、兼容矩阵与升级流程 | v1.0 |
| [`versions.json`](versions.json) | 机器可读的锁定版本清单 | v1.0 |
| [`ui-design.md`](ui-design.md) | UI 设计系统、页面规格、交互与无障碍 | v1.0 |
| [`ui/tokens.json`](ui/tokens.json) | 设计 token | v1.0 |
| [`ui/mockup.html`](ui/mockup.html) | 4 屏 HTML/CSS 视觉方向稿 | v1.0 |
| [`ui/screens/`](ui/screens/) | 视觉稿截图 | v1.0 |

## 阅读路径

- 产品/设计：`todo-app-design.md` → `requirements.md` → `ui-design.md`
- 客户端：`ui-design.md` → `requirements.md` §6.8 → `api/openapi.yaml`
- 服务端：`../backend/README.md` → `api/openapi.yaml` → `database.md`（MySQL DDL） → `todo-app-design.md` §3.7–§3.10
- 测试：`requirements.md` §10 → `database.md` §6 → `api/openapi.yaml`

## 校验

```bash
# Markdown 结构
npx markdownlint-cli2 docs/**/*.md

# OpenAPI
npx @redocly/cli lint docs/api/openapi.yaml

# SQL（需 PostgreSQL 实例或解析器）
psql -f docs/sql/001_init.sql

# JSON
python3 -m json.tool docs/versions.json >/dev/null
python3 -m json.tool docs/ui/tokens.json >/dev/null
```
