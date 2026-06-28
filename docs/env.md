# 环境变量配置

所有配置项通过 `.env` 文件或环境变量设置，`server/config.ts` 统一读取并提供类型安全的默认值。

## 快速参考

```bash
# 复制模板
cp .env.example .env

# 开发环境最小配置（其余使用默认值）
JWT_SECRET=dev-secret-change-me
```

## 完整配置项

### 服务

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 后端监听端口 |
| `NODE_ENV` | `development` | 运行环境（`production` 时 JWT 密钥强制检查） |
| `APP_BASE_URL` | `http://localhost:5173` | 前端地址（用于生成飞书 OAuth 回调等完整 URL） |
| `CORS_ORIGIN` | — | 额外 CORS 来源，逗号分隔（开发时 Vite dev server 自动允许） |

### 管理员账号

首次启动时自动创建，已存在则跳过。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `ADMIN_USERNAME` | `admin` | 管理员用户名 |
| `ADMIN_PASSWORD` | `admin123` | 管理员密码 |

### 安全

| 变量 | 默认值 | 说明 |
|---|---|---|
| `JWT_SECRET` | 开发环境随机生成 | JWT 签名密钥。**生产环境必须设置**，否则启动报错 |

### 数据库 & 存储路径

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DATABASE_PATH` | `./data/manual.db` | SQLite 数据库文件路径 |
| `DB_JOURNAL_MODE` | `wal` | SQLite WAL 模式（`wal` / `delete` / `memory`） |
| `UPLOAD_DIR` | `<cwd>/data/uploads` | 上传文件存储目录 |
| `EXPORT_DIR` | `<cwd>/data/exports` | 导出文件临时目录 |
| `IMPORT_DIR` | `<cwd>/data/imports` | 导入文件临时目录 |
| `CACHE_DIR` | `<cwd>/data/cache` | 缓存根目录 |

### 上传限制 (MB)

| 变量 | 默认值 | 说明 |
|---|---|---|
| `UPLOAD_MAX_SIZE` | `10` | 图片上传大小上限（MB） |
| `VIDEO_MAX_SIZE` | `100` | 视频上传大小上限（MB） |

### 日志

使用 Pino 结构化日志，双路输出（stdout + 文件轮转）。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `LOG_LEVEL` | 开发 `debug` / 生产 `info` | 控制台日志级别（trace/debug/info/warn/error/fatal） |
| `LOG_FILE_LEVEL` | 同 `LOG_LEVEL` | 文件日志级别（留空则继承控制台级别） |
| `LOG_FILE_PATH` | `<cwd>/data/logs/app.log` | 日志文件路径（pino-roll 自动拼接日期和扩展名） |
| `LOG_HOSTNAME` | 本机 hostname | 生产日志中标记的主机名 |
| `LOG_MAX_SIZE_MB` | `10` | 单个日志文件最大大小（MB） |
| `LOG_RETAIN_DAYS` | `30` | 日志文件保留天数 |

### Y.js 协同编辑

| 变量 | 默认值 | 说明 |
|---|---|---|
| `YJS_SNAPSHOT_UPDATE_THRESHOLD` | `500` | 增量更新累积超过此数量后自动创建快照 |

### 缓存

| 变量 | 默认值 | 说明 |
|---|---|---|
| `REMOTE_CACHE_TTL_DAYS` | `7` | 远程资源缓存过期天数（粘贴外部图片链接时自动下载缓存） |
| `EXPORT_CACHE_TTL_DAYS` | `30` | 导出文件缓存过期天数 |
| `REMOTE_CACHE_MAX_FILE_MB` | `50` | 远程缓存单文件大小上限（MB） |

### AI 辅助写作

OpenAI 兼容接口，支持 OpenAI / DeepSeek / Ollama / 通义千问 等。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `AI_BASE_URL` | — | AI API 地址（留空则禁用 AI 功能） |
| `AI_API_KEY` | — | API 密钥 |
| `AI_MODEL` | `gpt-4o-mini` | 模型名称 |

### 飞书集成

不启用则全部留空。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `FEISHU_APP_ID` | — | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | — | 飞书应用 App Secret |
| `FEISHU_REDIRECT_URI` | — | 飞书 OAuth 回调地址（如 `http://localhost:5173/feishu-callback`） |
| `FEISHU_HOST` | `https://open.feishu.cn` | 飞书 API 域名（国际版用 `https://open.larksuite.com`） |
| `ADMIN_OPEN_IDS` | — | 管理员飞书 open_id，逗号分隔（用于飞书消息通知的目标用户） |

### PDF 导出

基于 Puppeteer 将 Markdown 渲染为 PDF。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PUPPETEER_EXECUTABLE_PATH` | — | Chromium 可执行文件路径（Docker 内 `/usr/bin/chromium`，本地留空用 puppeteer 自带） |
| `PUPPETEER_SKIP_DOWNLOAD` | — | 设为 `true` 跳过 puppeteer 的 Chromium 下载（使用系统已安装的） |
| `PDF_FONT_REGULAR` | — | PDF 正文中文字体路径（不设则使用系统默认字体） |
| `PDF_FONT_BOLD` | — | PDF 粗体中文字体路径 |

### 默认项目只读

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DEFAULT_PROJECT_READONLY` | `false` | 上线后设为 `true`，default 项目仅允许添加成员，不可编辑 |

## Docker 部署

Docker 内路径与本地开发不同：

```bash
# Docker 路径（.env.example 中预置）
DATABASE_PATH=/app/data/manual.db
UPLOAD_DIR=/app/data/uploads
EXPORT_DIR=/app/data/exports
IMPORT_DIR=/app/data/imports
CACHE_DIR=/app/data/cache
LOG_FILE_PATH=/app/data/logs/app.log
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
PUPPETEER_SKIP_DOWNLOAD=true
```

数据持久化需挂载 `./data:/app/data`。
