# ⚡ Cloudflare D1 + R2 + KV Backup & Cross-Account Migration Center

> A one-stop **backup, restore and cross-account migration** console for Cloudflare **D1 / R2 / KV**,
> built on **Cloudflare Workers + D1**. Deploy a single Worker and go — zero frontend build, zero backend dependencies.

<p align="center">
  <img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white" alt="Workers"/>
  <img src="https://img.shields.io/badge/D1-Database-3B82F6?logo=cloudflare&logoColor=white" alt="D1"/>
  <img src="https://img.shields.io/badge/R2-Storage-F6821F?logo=cloudflare&logoColor=white" alt="R2"/>
  <img src="https://img.shields.io/badge/KV-KeyValue-22C55E?logo=cloudflare&logoColor=white" alt="KV"/>
  <img src="https://img.shields.io/badge/License-MIT-blue" alt="MIT"/>
</p>

> 🇨🇳 中文文档请看 [README.md](./README.md)

---

## ✨ Features

### 1. Login with graphic captcha
- Username + password + **SVG captcha** (noise lines, dots, random rotation)
- Credentials stored in the **database** (default `admin` / `123456`, forced change on first login)
- **PBKDF2-SHA256** password hashing (120k iterations, random salt, constant-time compare)
- Session cookies are `HttpOnly` + `Secure` + `SameSite=Lax`; only the SHA-256 of the token is stored
- Brute-force protection: lock for 10 minutes after 5 failed attempts (configurable)
- Captcha answer lives in a signed **httpOnly cookie** — JavaScript can never read it

### 2. Sidebar menu + content area
| Menu | What it does |
| --- | --- |
| 📊 **Dashboard** | Account / D1 / R2 / KV stats, data volume, recent tasks, activity log, health check |
| ☁️ **CF Accounts** | Search + batch delete + add account; list shows account + its resources, with edit / delete / test / sync |
| 🗄️ **D1** | Search + batch delete; list shows databases + owning CF account + data size, with edit / delete / backup / migrate |
| 🪣 **R2** | Search + batch delete; list shows buckets + owning CF account + object data, with edit / delete / manifest / migrate |
| 🔑 **KV** | Search + batch delete; list shows namespaces + owning CF account + key data, with edit / delete / backup / migrate |
| ⏱️ **Tasks** | Backup / restore / migration job history with progress bars and line-by-line logs |
| 👤 **Profile** | Login username, password and other data — **username and password are both editable**; session management |
| 🚪 **Sign out** | Destroy session and return to login |

### 3. Themes + Chinese/English switching
- ☀️ **Light** (default) / 🌙 Dark / 🌈 Aurora (proof of multi-theme support)
- 🇨🇳 **简体中文** (default) / 🇺🇸 English
- Both the login page and the console can switch; preference is persisted (localStorage + user profile)
- 8 accent colors
- **Extensible themes**: one CSS block + one registry entry (see below)

### 4. Backup · Restore · Cross-account migration (the core)
| Capability | D1 | R2 | KV |
| --- | --- | --- | --- |
| Resource inventory sync | ✅ | ✅ | ✅ |
| Backup export | ✅ SQL / JSON | ✅ object manifest JSON | ✅ JSON (values + metadata) |
| Restore from backup | ✅ upload file | — | ✅ upload file |
| **Cross-account migration** | ✅ schema + all rows | ✅ streaming object copy | ✅ bulk key/value copy |
| Live detail | ✅ tables / read-only query | ✅ object list | ✅ key list / value lookup |

Target resources are **auto-created** when missing (database / bucket / namespace).

---

## 🚀 Quick Start

> Requirements: Node.js ≥ 18 and a Cloudflare account (free plan works).

```bash
# 1. Clone & install
git clone https://github.com/hltxme/d1-r2-kv-backup-migration-center.git
cd d1-r2-kv-backup-migration-center
npm install

# 2. Login to Cloudflare
npx wrangler login

# 3. Create the D1 database
npx wrangler d1 create d1-r2-kv-center
# → copy the database_id into wrangler.jsonc

# 4. (Recommended) set the encryption secret
npx wrangler secret put APP_SECRET       # e.g. openssl rand -hex 32
# optional: npx wrangler secret put ADMIN_PASSWORD

# 5. Deploy
npm run deploy

# 6. Open https://<your-worker>.workers.dev/  →  admin / 123456
```

Tables and the default admin account are **created automatically on first request**.
To create them manually instead: `npm run db:init`.

### Local development

```bash
npm run dev      # wrangler dev with a local D1
npm run tail     # live logs
npm run check    # syntax check
```

---

## ⚙️ Configuration

`wrangler.jsonc` → `vars`:

| Variable | Default | Description |
| --- | --- | --- |
| `APP_NAME` | `D1 + R2 + KV Backup & Migration Center` | Site name |
| `APP_DEFAULT_LOCALE` | `zh-CN` | `zh-CN` / `en` |
| `APP_DEFAULT_THEME` | `light` | `light` / `dark` / `aurora` |
| `APP_DEFAULT_ACCENT` | `indigo` | Accent color |
| `SESSION_TTL_DAYS` | `7` | Session lifetime |
| `CAPTCHA_TTL_SECONDS` | `300` | Captcha lifetime |
| `LOGIN_MAX_ATTEMPTS` | `5` | Failed attempts before lockout |
| `LOGIN_LOCK_MINUTES` | `10` | Lockout duration |
| `PBKDF2_ITERATIONS` | `120000` | Password hash cost |

Secrets (via `wrangler secret put`):

| Secret | Required | Description |
| --- | --- | --- |
| `APP_SECRET` | recommended | AES-GCM key for encrypting stored CF API tokens |
| `ADMIN_PASSWORD` | no | Overrides the default `123456` |

---

## 🔐 Cloudflare API permissions

Create an API token with:

| Permission | Level | Used for |
| --- | --- | --- |
| `Account / Account Settings` | Read | Account info |
| `Account / D1` | Edit | List / query / create databases |
| `Account / Workers R2 Storage` | Edit | List / create buckets |
| `Account / Workers KV Storage` | Edit | Namespaces & key/value access |

**R2 object-level operations** (backup / migration) additionally require **R2 Access Keys**
(R2 object I/O only works through the S3-compatible API):

1. Cloudflare dashboard → **R2** → **Manage R2 API Tokens**
2. Create a token with **Object Read & Write**
3. Copy the *Access Key ID* / *Secret Access Key*
4. Paste them into **CF Accounts → Edit** in this project

---

## 🎨 Extending themes

1. Add a `[data-theme="ocean"]` block in `public/css/tokens.css`
2. Register it in the `THEMES` array of `public/js/theme.js`

That's it — the theme pickers on the login page, console and profile page pick it up automatically.

Adding an accent color: add `[data-accent="teal"] { --primary: ...; }` and register it in `ACCENTS`.

Adding a language: add a block to `I18N` in `public/js/i18n.js` and register it in `LOCALES`.

---

## 📁 Project layout

```
├── wrangler.jsonc        # Workers config (D1 binding, static assets, env vars)
├── schema.sql            # Metadata schema (kept in sync with src/seed.js)
├── public/               # Frontend (Workers Static Assets, served from the CDN)
│   ├── index.html        # Login page
│   ├── app.html          # Console shell
│   ├── css/tokens.css    # 🎨 Design tokens + theme definitions
│   ├── css/{base,login,app}.css
│   └── js/
│       ├── i18n.js       # 🌐 Chinese / English strings
│       ├── theme.js      # 🎨 Theme registry
│       ├── api.js, ui.js, login.js, app.js
│       └── pages/        # dashboard / accounts / resources / tasks / profile
└── src/                  # Worker backend
    ├── index.js          # Entry router
    ├── seed.js           # Auto schema + default admin
    ├── lib/              # http, crypto (PBKDF2/AES-GCM/HMAC), auth, captcha, db, repo, router
    ├── cf/               # Cloudflare REST client + R2 S3 client (hand-rolled SigV4)
    ├── services/         # Task pipeline + backup/restore/migrate engine
    └── routes/           # auth, accounts, resources, backup, dashboard
```

---

## 🧩 API overview

All endpoints return `{ success, data, message }` or `{ success:false, code, message }`.

See the [API table in the Chinese README](./README.md#-api-一览) for the full list.

---

## 🛡️ Security notes

1. **Set `APP_SECRET`** — `npx wrangler secret put APP_SECRET`
2. **Change the default account** right after the first login
3. Use **least-privilege** CF API tokens, scoped to the accounts you actually need
4. Scope R2 Access Keys to only the buckets you migrate
5. Optionally put **Cloudflare Access** in front of the Worker
6. Every critical action is written to the `audit_logs` table

---

## 📄 License

[MIT](./LICENSE) © 2026 [hltxme](https://github.com/hltxme)
