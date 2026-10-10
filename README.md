# ⚡ Cloudflare D1 + R2 + KV 数据备份与跨账号迁移中心

> 基于 **Cloudflare Workers + D1** 的一站式数据备份、恢复与**跨账号迁移**控制台。
> 单个 Worker 部署即可使用，前端零构建、后端零依赖，全程跑在 Cloudflare 边缘节点。

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/hltxme/d1-r2-kv-backup-migration-center"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare"/></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white" alt="Workers"/>
  <img src="https://img.shields.io/badge/D1-Database-3B82F6?logo=cloudflare&logoColor=white" alt="D1"/>
  <img src="https://img.shields.io/badge/R2-Storage-F6821F?logo=cloudflare&logoColor=white" alt="R2"/>
  <img src="https://img.shields.io/badge/KV-KeyValue-22C55E?logo=cloudflare&logoColor=white" alt="KV"/>
  <img src="https://img.shields.io/badge/License-MIT-blue" alt="MIT"/>
</p>

---

## 📖 目录

- [功能特性](#-功能特性)
- [界面预览](#-界面预览)
- [技术架构](#-技术架构)
- [快速部署](#-快速部署)
- [本地开发](#-本地开发)
- [配置说明](#-配置说明)
- [Cloudflare API 权限](#-cloudflare-api-权限)
- [主题与多语言扩展](#-主题与多语言扩展)
- [目录结构](#-目录结构)
- [API 一览](#-api-一览)
- [安全建议](#-安全建议)
- [常见问题](#-常见问题)

---

## ✨ 功能特性

### 1️⃣ 图形验证码登录

| 特性 | 说明 |
| --- | --- |
| 用户名 + 密码 + **图形验证码** 三段式登录 | 服务端生成 SVG 验证码，含干扰线 / 干扰点 / 随机旋转 |
| 帐密存放在 **数据库** 中 | 默认账号 `admin` / `123456`，首次登录强制提示修改 |
| PBKDF2-SHA256 密码哈希 | 12 万次迭代 + 16 字节随机盐，常量时间比较 |
| 会话 Cookie | `HttpOnly` + `Secure` + `SameSite=Lax`，数据库只存 Token 的 SHA-256 |
| 登录风控 | 连续失败 5 次锁定 10 分钟（次数与锁定时长可配置） |
| 验证码防破解 | 答案放在 **httpOnly Cookie** 中并用 HMAC 签名，JS 无法读取 |

### 2️⃣ 左侧菜单 + 右侧功能区

登录后为经典后台布局：**左侧导航栏 / 右侧功能区**。

| 菜单 | 功能 |
| --- | --- |
| 📊 **仪表盘** | 账号 / D1 / R2 / KV 资源统计、数据体量、最近任务、最近操作、系统体检、快捷入口 |
| ☁️ **CF 账号管理** | 搜索框 + 批量删除 + 添加 CF 号；列表展示账号及其关联资源数量 + 编辑 / 删除 / 测试连接 / 同步资源 |
| 🗄️ **D1 管理** | 搜索框 + 批量删除；列表展示 D1 数据库及其所属 CF 账号与数据量 + 编辑 / 删除 / 备份导出 / 跨账号迁移 |
| 🪣 **R2 管理** | 搜索框 + 批量删除；列表展示 R2 存储桶及其所属 CF 账号与对象数据 + 编辑 / 删除 / 对象清单导出 / 跨账号迁移 |
| 🔑 **KV 管理** | 搜索框 + 批量删除；列表展示 KV 命名空间及其所属 CF 账号与键值数据 + 编辑 / 删除 / 备份导出 / 跨账号迁移 |
| ⏱️ **任务记录** | 备份 / 恢复 / 迁移任务流水，含进度条与逐行执行日志 |
| 👤 **个人资料** | 登录用户名、密码及其他数据；**用户名 / 密码均可修改**；登录设备管理 |
| 🚪 **退出登录** | 销毁会话并返回登录页 |

### 3️⃣ 主题风格 + 中英文切换

- ☀️ **白色风格**（默认） / 🌙 深色 / 🌈 极光（示例第三主题）
- 🇨🇳 **简体中文**（默认） / 🇺🇸 English
- 登录页与控制台**均**可切换主题与语言，偏好自动持久化（localStorage + 用户资料）
- 8 种强调色（indigo / blue / cyan / emerald / amber / rose / violet / slate）
- **多主题可扩展**：加一段 CSS + 一行注册表即可，见 [主题与多语言扩展](#-主题与多语言扩展)

### 4️⃣ 备份 · 恢复 · 跨账号迁移（项目核心）

| 能力 | D1 | R2 | KV |
| --- | --- | --- | --- |
| 资源清单同步 | ✅ | ✅ | ✅ |
| 备份导出 | ✅ SQL / JSON 文件 | ✅ 对象清单 JSON | ✅ JSON（含值与元数据） |
| 从备份恢复 | ✅ 上传文件写入目标库 | — | ✅ 上传文件写入目标命名空间 |
| **跨账号迁移** | ✅ 表结构 + 全量数据 | ✅ 流式对象复制 | ✅ 批量键值复制 |
| 实时详情 | ✅ 表结构 / 只读查询 | ✅ 对象列表 | ✅ 键列表 / 单键取值 |

> 迁移时若目标资源不存在，可**自动创建**（D1 数据库 / R2 桶 / KV 命名空间）。

---

## 🖼️ 界面预览

**登录页**：左侧品牌插画区 + 右侧登录卡片，右上角主题 / 语言切换。

**控制台**：左侧固定导航 + 顶栏（面包屑、刷新、主题、语言、用户菜单）+ 内容区卡片化布局。

设计规范：

- 统一 Design Tokens（`public/css/tokens.css`），颜色 / 圆角 / 阴影 / 间距全部变量化
- 卡片圆角 16px、柔和投影、hover 微抬升、骨架屏加载、Toast / Modal / 空状态组件齐全
- 表格粘性表头、行选择高亮、操作按钮图标化
- 响应式：窄屏自动隐藏侧边栏与顶部搜索

---

## 🏗️ 技术架构

```
┌──────────────────────────────────────────────────────────┐
│                    Cloudflare Worker                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │  路由 /api/* │  │  鉴权 / 会话 │  │  SVG 图形验证码 │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬───────┘  │
│         │                 │                    │          │
│  ┌──────▼─────────────────▼────────────────────▼───────┐  │
│  │           业务层（账号 / 资源 / 备份 / 任务）          │  │
│  └──────┬─────────────────┬────────────────────┬───────┘  │
│         │                 │                    │          │
│  ┌──────▼──────┐   ┌──────▼───────┐   ┌────────▼───────┐  │
│  │ D1 元数据库 │   │ CF REST API  │   │ R2 S3 API      │  │
│  │ 用户/账号/  │   │ D1 / R2 / KV │   │ SigV4 签名     │  │
│  │ 资源/任务   │   │ 管理接口     │   │ 对象级读写     │  │
│  └─────────────┘   └──────────────┘   └────────────────┘  │
│                                                          │
│  public/  ← Workers Static Assets（前端直出，走 CDN）      │
└──────────────────────────────────────────────────────────┘
```

- **运行时**：Cloudflare Workers（V8 isolates，冷启动 < 5ms）
- **元数据**：Cloudflare D1（SQLite）
- **前端**：原生 ES Modules + CSS 变量主题系统，**无框架、无构建步骤**
- **加密**：Web Crypto（PBKDF2 密码哈希、AES-GCM 敏感字段加密、HMAC 签名）
- **远程调用**：Cloudflare Account REST API + R2 S3 兼容 API（AWS SigV4 手写签名）

---

## 🚀 快速部署

> 前置要求：一个 Cloudflare 账号（免费套餐即可）。命令行方式额外需要 Node.js ≥ 18。

### 🌐 方式一：浏览器一键部署（推荐 · 无需命令行）

1. 点击上方 **Deploy to Cloudflare** 按钮
   （或直接打开 <https://deploy.workers.cloudflare.com/?url=https://github.com/hltxme/d1-r2-kv-backup-migration-center>）
2. 登录 Cloudflare，按提示**授权 GitHub**
3. Cloudflare 会在你的 GitHub 账号下自动创建仓库副本，并开始构建部署
   - ✅ **D1 数据库会自动创建并绑定**，不需要手动填 database_id
   - ✅ 前端静态资源、环境变量都从 `wrangler.jsonc` 自动读取
4. 部署完成后，进入 **Workers & Pages → 你的 Worker → Settings → Variables and Secrets**
   添加一条 **Secret** 类型变量 `APP_SECRET`（值随便敲一长串随机字符即可）
   > 不加也能用（会自动用一个密钥），但加上更安全。
5. 打开 `https://<你的-worker>.<你的子域>.workers.dev/` → 默认账号 `admin` / `123456`

### 🌐 方式二：Cloudflare 控制台导入 GitHub 仓库（纯浏览器）

如果你不想用 Deploy 按钮（比如想用自己已有的仓库）：

1. 打开 [Cloudflare 控制台](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Import a repository**
2. 首次使用会提示 **Connect GitHub**，授权后选择 `hltxme/d1-r2-kv-backup-migration-center`
3. 构建配置（Build configuration）：

   | 项 | 值 |
   | --- | --- |
   | Framework preset | `None` / `无` |
   | Build command | `npm ci` |
   | Deploy command | `npx wrangler deploy` |
   | Node 版本 | 默认即可 |

4. 点击 **Deploy**，等待构建完成
5. 同方式一，到 **Settings → Variables and Secrets** 添加 `APP_SECRET`

> 💡 只要 `wrangler.jsonc` 里的 D1 绑定**没有写 database_id**，控制台部署时就会自动创建 D1 并绑定。
> 本仓库已经是这种写法，开箱即用。

### 🖥️ 方式三：命令行部署（Wrangler CLI）

#### 1. 克隆仓库

```bash
git clone https://github.com/hltxme/d1-r2-kv-backup-migration-center.git
cd d1-r2-kv-backup-migration-center
npm install
```

#### 2. 登录 Cloudflare

```bash
npx wrangler login
```

#### 3. 创建 D1 数据库（可选）

`wrangler.jsonc` 中的 D1 绑定**没有写 database_id**，因此 `npm run deploy` 时会**自动创建并回填 ID**，通常无需手动操作。

如果你想先手动建库：

```bash
npx wrangler d1 create d1-r2-kv-center
```

输出类似：

```
[[d1_databases]]
binding = "DB"
database_name = "d1-r2-kv-center"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"   ← 可选：填入 wrangler.jsonc
```

填入 `wrangler.jsonc` 的 `d1_databases[0].database_id` 即可使用已有库；不填则自动新建。

#### 4. 设置加密密钥（强烈建议）

```bash
npx wrangler secret put APP_SECRET
# 输入一个随机串，例如用 openssl rand -hex 32 生成
```

> 不设置也能运行：首次启动会自动生成随机密钥并存入 D1（仪表盘会给出安全提示）。
> 但密钥与密文同库会降低安全性，**生产环境请务必设置 `APP_SECRET`**。

可选：自定义初始管理员密码

```bash
npx wrangler secret put ADMIN_PASSWORD    # 默认 123456
```

#### 5. 部署

```bash
npm run deploy
```

#### 6. 打开控制台

访问 `https://<你的-worker>.workers.dev/`

- 默认账号：`admin`
- 默认密码：`123456`
- **首次登录后请立即在「个人资料」中修改用户名与密码**

#### 7. 建表（可选）

Worker 会在首次请求时**自动建表并创建默认管理员**，通常无需手动执行。
如果你想手动建表：

```bash
npm run db:init        # 远端
npm run db:init:local  # 本地
```

---

## 🛠️ 本地开发

```bash
npm run dev            # 等价于 wrangler dev，本地 D1 自动创建
```

打开 <http://127.0.0.1:8787>

```bash
npm run tail           # 查看实时日志
npm run check          # 语法检查
npm run db:console     # 查看 users 表
```

> 本地开发时浏览器可能因 `Secure` Cookie 与 http 源冲突导致登录态不生效，
> 建议使用 `npm run deploy` 部署后在 https 下体验完整流程。

---

## ⚙️ 配置说明

### `wrangler.jsonc` 中的 `vars`

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_NAME` | `D1 + R2 + KV 数据备份与跨账号迁移中心` | 站点名称 |
| `APP_SHORT_NAME` | `Backup Center` | 侧边栏简称 |
| `APP_VERSION` | `1.0.0` | 版本号 |
| `APP_DEFAULT_LOCALE` | `zh-CN` | 默认语言（`zh-CN` / `en`） |
| `APP_DEFAULT_THEME` | `light` | 默认主题（`light` / `dark` / `aurora`） |
| `APP_DEFAULT_ACCENT` | `indigo` | 默认强调色 |
| `SESSION_TTL_DAYS` | `7` | 登录会话有效期（天） |
| `CAPTCHA_TTL_SECONDS` | `300` | 验证码有效期（秒） |
| `LOGIN_MAX_ATTEMPTS` | `5` | 允许连续登录失败次数 |
| `LOGIN_LOCK_MINUTES` | `10` | 锁定时长（分钟） |
| `PBKDF2_ITERATIONS` | `120000` | 密码哈希迭代次数 |

### `wrangler secret` 密钥

| 密钥 | 必填 | 说明 |
| --- | --- | --- |
| `APP_SECRET` | 建议 | 用于 AES-GCM 加密存储 CF API Token；未设置则自动生成 |
| `ADMIN_PASSWORD` | 否 | 覆盖默认初始密码 `123456` |

---

## 🔐 Cloudflare API 权限

在 Cloudflare 控制台 **My Profile → API Tokens → Create Token** 创建令牌，建议权限：

| 权限 | 级别 | 用途 |
| --- | --- | --- |
| `Account / Account Settings` | Read | 读取账号信息 |
| `Account / D1` | Edit | D1 列表 / 查询 / 建库 |
| `Account / Workers R2 Storage` | Edit | R2 桶列表 / 建桶 |
| `Account / Workers KV Storage` | Edit | KV 命名空间与键值读写 |

> 权限范围建议限定到**目标账号**，不要使用 Global API Key。

### R2 对象级操作（迁移 / 备份）额外需要 Access Key

Cloudflare 的 **R2 对象读写只能走 S3 兼容 API**，需要单独创建 R2 Access Key：

1. Cloudflare 控制台 → **R2** → 右上角 **管理 R2 API 令牌**
2. 创建 API 令牌，权限选择 **对象读 & 写**，指定桶或整个账号
3. 生成后复制 **Access Key ID** 与 **Secret Access Key**
4. 在本项目「CF 账号管理 → 编辑」中填入即可

> 只做 D1 / KV 操作、不碰 R2 对象时，可以不填 R2 Access Key。

---

## 🎨 主题与多语言扩展

### 新增一个主题

**第 1 步**：在 `public/css/tokens.css` 末尾追加一个主题块

```css
[data-theme="ocean"] {
  color-scheme: light;
  --bg: #eef6fb;
  --surface: #ffffff;
  --surface-2: #f5fafd;
  --surface-3: #e8f2f8;
  --border: #d6e7f2;
  --border-strong: #bcd8e8;
  --text: #0b2b3c;
  --text-secondary: #2f5a72;
  --text-muted: #7096ac;
  --shadow-sm: 0 1px 3px rgba(11, 43, 60, 0.08);
  --sidebar-bg: #f7fbfd;
  --sidebar-border: #dceaf3;
  --sidebar-text: #2f5a72;
  --sidebar-text-active: #0284c7;
  --table-header: #f2f9fc;
  --table-stripe: #fafcfe;
  --scrollbar: #c3dcea;
}
```

**第 2 步**：在 `public/js/theme.js` 的 `THEMES` 数组登记

```js
{
  id: 'ocean',
  nameKey: 'theme.ocean',      // 记得在 i18n.js 补上翻译
  descKey: 'theme.oceanDesc',
  swatches: ['#eef6fb', '#ffffff', '#7dd3fc', '#0284c7'],
},
```

完成 ✅ 登录页、控制台、个人资料页的主题选择器都会自动出现新主题。

### 新增强调色

在 `public/css/tokens.css` 追加 `[data-accent="teal"] { --primary: ...; --primary-gradient: ...; }`，
再在 `public/js/theme.js` 的 `ACCENTS` 数组登记即可。

### 新增语言

在 `public/js/i18n.js` 的 `I18N` 中新增一个语言块（键名完全一致即可），
并在 `LOCALES` 数组登记 `{ id, label, short, flag }`。

---

## 📁 目录结构

```
d1-r2-kv-backup-migration-center/
├── wrangler.jsonc            # Workers 配置（D1 绑定、静态资源、环境变量）
├── schema.sql                # 元数据库结构（与 src/seed.js 保持一致）
├── package.json
├── public/                   # 前端静态资源（Workers Static Assets 直出）
│   ├── index.html            # 登录页
│   ├── app.html              # 控制台外壳
│   ├── favicon.svg
│   ├── _headers              # 静态资源安全响应头
│   ├── css/
│   │   ├── tokens.css        # 🎨 Design Tokens + 多主题定义
│   │   ├── base.css          # 基础组件（按钮 / 表单 / 表格 / 徽章…）
│   │   ├── login.css         # 登录页
│   │   └── app.css           # 控制台布局 / 弹窗 / Toast / 主题卡片
│   └── js/
│       ├── i18n.js           # 🌐 中英文文案
│       ├── theme.js          # 🎨 主题注册表
│       ├── api.js            # fetch 封装 / 文件下载
│       ├── ui.js             # 图标 / Toast / Modal / 分页 / 格式化
│       ├── login.js          # 登录页逻辑
│       ├── app.js            # 控制台外壳 + 路由
│       └── pages/
│           ├── dashboard.js  # 仪表盘
│           ├── accounts.js   # CF 账号管理
│           ├── resources.js  # D1 / R2 / KV 通用页面
│           ├── tasks.js      # 任务记录
│           └── profile.js    # 个人资料
└── src/                      # Worker 后端
    ├── index.js              # 入口路由
    ├── seed.js               # 自动建表 + 默认管理员
    ├── lib/
    │   ├── http.js           # 统一响应 / Cookie / 校验
    │   ├── crypto.js         # PBKDF2 / AES-GCM / HMAC
    │   ├── auth.js           # 会话 / 风控 / 审计
    │   ├── captcha.js        # SVG 图形验证码
    │   ├── db.js             # D1 封装 + 设置项
    │   ├── repo.js           # 账号/资源仓储 + 密钥解密
    │   └── router.js         # 极简路由器
    ├── cf/
    │   ├── client.js         # Cloudflare Account REST API
    │   ├── s3.js             # R2 S3 API（AWS SigV4 签名）
    ├── services/
    │   ├── tasks.js          # 任务流水
    │   └── migrate.js        # 备份 / 恢复 / 迁移引擎
    └── routes/
        ├── auth.js           # 验证码 / 登录 / 资料 / 密码
        ├── accounts.js       # CF 账号 CRUD + 同步
        ├── resources.js      # D1 / R2 / KV 资源 CRUD
        ├── backup.js         # 备份 / 恢复 / 迁移
        └── dashboard.js      # 仪表盘 / 设置 / 审计
```

---

## 🧩 API 一览

所有接口统一返回：

```jsonc
{ "success": true,  "data": {}, "message": "..." }
{ "success": false, "code": "ERR_XXX", "message": "..." }
```

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/auth/captcha` | 获取验证码 SVG（写入 httpOnly Cookie） |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 退出登录 |
| GET | `/api/auth/me` | 当前用户 |
| PUT | `/api/auth/profile` | 修改资料（含用户名 / 语言 / 主题） |
| POST | `/api/auth/password` | 修改密码 |
| GET/DELETE | `/api/auth/sessions` | 登录设备列表 / 注销其他设备 |
| GET | `/api/dashboard/summary` | 仪表盘概览 |
| GET | `/api/settings` | 站点信息与可用语言 |
| GET | `/api/health/detail` | 系统体检 |
| GET/POST/PUT/DELETE | `/api/accounts[/:id]` | CF 账号 CRUD |
| POST | `/api/accounts/batch-delete` | 批量删除 CF 账号 |
| POST | `/api/accounts/:id/test` | 测试 Token 连通性 |
| POST | `/api/accounts/:id/sync` | 从 Cloudflare 同步资源清单 |
| GET/POST/PUT/DELETE | `/api/d1[/:id]` | D1 资源 CRUD |
| GET | `/api/d1/:id/export?format=sql\|json` | 备份导出 |
| POST | `/api/d1/:id/migrate` | 跨账号迁移 |
| POST | `/api/d1/restore` | 从备份文件恢复 |
| GET | `/api/d1/:id/tables` | 查看表结构 |
| POST | `/api/d1/:id/query` | 只读 SQL 查询 |
| GET/POST/PUT/DELETE | `/api/r2[/:id]` | R2 资源 CRUD |
| GET | `/api/r2/:id/manifest` | 对象清单导出 |
| POST | `/api/r2/:id/migrate` | R2 跨账号/跨桶迁移 |
| GET | `/api/r2/:id/objects` | 对象列表（需 R2 Access Key） |
| GET/POST/PUT/DELETE | `/api/kv[/:id]` | KV 资源 CRUD |
| GET | `/api/kv/:id/export` | KV 备份导出 |
| POST | `/api/kv/:id/migrate` | KV 跨账号迁移 |
| POST | `/api/kv/restore` | 从备份文件恢复 |
| GET | `/api/kv/:id/keys` / `/api/kv/:id/value` | 键列表 / 取值 |
| GET | `/api/tasks[/:id]` | 任务流水与日志 |
| POST | `/api/tasks/batch-delete` | 清理任务记录 |
| POST | `/api/:type/:id/backup` | 登记「备份到指定账号」计划 |
| GET | `/api/audit` | 操作审计日志 |

---

## 🛡️ 安全建议

1. **务必设置 `APP_SECRET`**：`npx wrangler secret put APP_SECRET`
2. **修改默认账号**：首次登录后在「个人资料」中修改用户名与密码
3. **最小权限 Token**：CF API Token 只授予所需账号与权限
4. **限定 R2 Access Key 范围**：只绑定需要迁移的桶
5. **开启 Cloudflare Access**（可选）：在 Worker 前加一层 Zero Trust 访问控制
6. **定期清理会话**：个人资料页可一键注销其他设备
7. **审计留痕**：所有关键操作写入 `audit_logs` 表

---

## ❓ 常见问题

<details>
<summary><b>部署后打开页面是 404 / 白屏？</b></summary>

请确认 `wrangler.jsonc` 中 `assets.directory` 指向 `./public`，且已执行 `npm run deploy`（不是 `wrangler dev`）。
查看日志：`npm run tail`。
</details>

<details>
<summary><b>登录提示「验证码错误」？</b></summary>

点击验证码图片刷新后重试。若在 http 环境下测试，浏览器可能拒绝 `Secure` Cookie，请改用 https（workers.dev 默认是 https）。
</details>

<details>
<summary><b>同步资源时提示 Cloudflare API 失败？</b></summary>

检查 API Token 权限是否包含 `Account / D1 / Workers KV Storage / Workers R2 Storage` 的 **Edit**，
以及 Token 的「Account Resources」是否包含你添加的账号。
</details>

<details>
<summary><b>R2 迁移提示「尚未配置 R2 Access Key」？</b></summary>

R2 对象级操作必须走 S3 兼容 API，请在 Cloudflare R2 →「管理 R2 API 令牌」中创建 Access Key，
然后到「CF 账号管理 → 编辑」填入 Access Key ID 与 Secret Access Key。
</details>

<details>
<summary><b>大数据量迁移会超时吗？</b></summary>

Workers 有 CPU 时间限制（免费套餐约 10ms/请求），建议：
- D1 按表或按 ID 区间分批迁移
- R2 使用 `prefix` 参数按前缀分批
- KV 控制在 2 万键以内一批

任务进度与日志会写入「任务记录」，失败可查看逐行日志定位问题。
</details>

<details>
<summary><b>如何更换默认主题 / 语言？</b></summary>

修改 `wrangler.jsonc` 中的 `APP_DEFAULT_THEME` 与 `APP_DEFAULT_LOCALE` 后重新部署；
用户也可以在登录页或「个人资料」中自行切换，选择会被记住。
</details>

---

## 📄 License

[MIT](./LICENSE) © 2026 [hltxme](https://github.com/hltxme)
