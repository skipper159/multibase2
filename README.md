# Multibase

![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)
![Status](https://img.shields.io/badge/Status-Active-brightgreen)

**Multibase** is a hybrid orchestration platform combining a Node.js management API with Python-based automation. It is designed as a **"Single Pane of Glass"** for managing self-hosted Supabase instances, leveraging the standard Docker Compose runtime for reliability.

> 🛠️ **Check out the [Multibase System Checker](https://github.com/skipper159/Multibase-Checker)** – an interactive test app to verify all core functions (Database, Storage, Edge Functions, Realtime, MCP) of your instances!

---

## 🎬 Preview & Feedback

**YouTube Demo:** https://www.youtube.com/watch?v=hOz1U8KKDyc

**Live Demo / Feedback:** https://multibase.tyto-design.de
Found a bug or have a feature request? Post your feedback directly on the website.

> 📸 Screenshots coming soon

---

## 🚀 Quick Install

```bash
curl -sSL https://raw.githubusercontent.com/skipper159/multibase2/main/deployment/install.sh | sudo bash
```

The interactive wizard handles everything: dependencies, domains, SSL, admin account, and more. See [INSTALL.md](INSTALL.md) for the full guide.

---

## ✅ Feature Overview

All features from v1.0 to v1.8 are **released and production-ready**. Click a version to open its detailed feature document.

| Feature                                                  | Version |                Docs                 |
| :------------------------------------------------------- | :-----: | :---------------------------------: |
| Multi-Instance Docker Orchestration                      |  v1.0   |      [→](Markdowns/README.md)       |
| Auth & Session Management (JWT, Bcrypt, 2FA)             |  v1.0   |      [→](Markdowns/README.md)       |
| Backup & Restore (S3, Scheduling, PITR)                  |  v1.1   | [→](Markdowns/Readme1_1_feature.md) |
| Monitoring, Alerts & Audit Logs                          |  v1.1   | [→](Markdowns/Readme1_1_feature.md) |
| Storage Manager (Upload, Signed URLs, Folders)           |  v1.2   | [→](Markdowns/Readme1_2_Feature.md) |
| Instance Cloning & Snapshots                             |  v1.2   | [→](Markdowns/Readme1_2_Feature.md) |
| Cloud Architecture (Shared Services, ~75% RAM savings)   |  v1.3   | [→](Markdowns/Readme1_3_Feature.md) |
| Kong → Nginx Gateway Migration                           |  v1.3   | [→](Markdowns/Readme1_3_Feature.md) |
| AI Chat Agent (30+ Tools, Multi-Provider)                |  v1.3   | [→](Markdowns/Readme1_3_Feature.md) |
| Workspace Page (Studio, API Keys, SMTP)                  |  v1.3   | [→](Markdowns/Readme1_3_Feature.md) |
| Multi-Tenancy / Organizations / RBAC                     |  v1.4   | [→](Markdowns/Readme1_4_Feature.md) |
| GraphQL API Playground (pg_graphql)                      |  v1.5   | [→](Markdowns/Readme1_5_Feature.md) |
| Database Webhooks (pg_net)                               |  v1.5   | [→](Markdowns/Readme1_5_Feature.md) |
| Cron Job Manager (pg_cron)                               |  v1.5   | [→](Markdowns/Readme1_5_Feature.md) |
| AI & Vectors (pgvector, Semantic Search)                 |  v1.5   | [→](Markdowns/Readme1_5_Feature.md) |
| Message Queues (pgmq)                                    |  v1.5   | [→](Markdowns/Readme1_5_Feature.md) |
| Auth Extensions (Phone/CAPTCHA/SAML/Social Login)        |  v1.6   | [→](Markdowns/Readme1_6_Feature.md) |
| Custom Domains per Tenant                                |  v1.6   | [→](Markdowns/Readme1_6_Feature.md) |
| Environment Labels + Clone Shortcuts                     |  v1.6   | [→](Markdowns/Readme1_6_Feature.md) |
| Storage: Tus Resumable Uploads + Nginx CDN Cache         |  v1.6   | [→](Markdowns/Readme1_6_Feature.md) |
| Vault Secrets UI (pgsodium)                              |  v1.6   | [→](Markdowns/Readme1_6_Feature.md) |
| Network Restrictions (IP Whitelist, Rate Limiting)       |  v1.6   | [→](Markdowns/Readme1_6_Feature.md) |
| Edge Functions IDE (CodeMirror, TypeScript, Test Runner) |  v1.7   | [→](Markdowns/Readme1_7_Feature.md) |
| Realtime Dashboard (Channels, Presence, Live Stats)      |  v1.7   | [→](Markdowns/Readme1_7_Feature.md) |
| Log Drains (Webhook Export, json/ndjson)                 |  v1.7   | [→](Markdowns/Readme1_7_Feature.md) |
| Read Replicas (External PostgreSQL Registration)         |  v1.7   | [→](Markdowns/Readme1_7_Feature.md) |
| MCP Server (12 Tools, JSON-RPC 2.0)                      |  v1.7   | [→](Markdowns/Readme1_7_Feature.md) |
| Extension Marketplace (51 Extensions)                    |  v1.8   |                 ✅                  |
| Feedback Feature (Public API + Admin Settings)           |  v1.8   |                 ✅                  |

> 🔮 **Planned features (v2.0+):** Multi-Region Control Plane, GitOps/Terraform Provider, AI-Powered Database Advisor, Reseller & White-Label, Database Branching, Management SDK/CLI, and more — see the full [Feature Roadmap →](Markdowns/4.0.0_Feature_Roadmap.md)

---

## 🛠️ Tech Stack

| Layer                        | Technology                                       |
| :--------------------------- | :----------------------------------------------- |
| **Dashboard Backend**        | Node.js 20+, Express, TypeScript                 |
| **Dashboard Database**       | SQLite via Prisma ORM                            |
| **Dashboard Frontend**       | React 19, Vite, Radix UI                         |
| **Infrastructure Scripting** | Python 3 (project generation, secret management) |
| **Container Runtime**        | Docker + Docker Compose                          |
| **API Gateway**              | Nginx (replaces per-tenant Kong from v1.3)       |
| **Process Manager**          | PM2                                              |
| **SSL**                      | Certbot (Let's Encrypt)                          |

---

## 🏗️ Architecture Overview

Multibase has three layers:

| Layer                    | What it does                                                                                                                                                     |
| :----------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Management Layer**     | Node.js + Express dashboard. SQLite stores metadata & audit logs. Spawns Python subprocesses for infrastructure tasks. Communicates with Docker via `dockerode`. |
| **Infrastructure Layer** | Each Supabase instance lives in `projects/<name>/` with its own `.env`, `docker-compose.yml`, and `volumes/` directory. Backup = tar the directory.              |
| **Runtime Layer**        | Instances run as isolated Docker Compose stacks on dedicated bridge networks, with a central port registry preventing conflicts.                                 |

### Cloud Architecture (v1.3+ — Shared Infrastructure)

Instead of running 13 containers per project, heavy services are shared across all tenants.

**Shared Services** (8 containers, fixed): PostgreSQL, Studio, Analytics, Vector, imgproxy, Connection Pooler, Meta, **Nginx Gateway**

**Per-Tenant Services** (5 containers each): `auth`, `rest`, `realtime`, `storage`, `edge-functions`

| Metric                   | Classic (10 Projects) | Cloud (10 Projects) |  Saving  |
| :----------------------- | :-------------------: | :-----------------: | :------: |
| **Containers**           |          130          |         58          | **-55%** |
| **RAM (idle)**           |        ~20 GB         |        ~5 GB        | **-75%** |
| **PostgreSQL instances** |          10           |          1          | **-90%** |

---

## 💻 Local Development Setup

### 1. Start Shared Infrastructure

```bash
# Copy and edit the shared environment file
cp shared/.env.shared.example shared/.env.shared
nano shared/.env.shared  # at minimum change passwords and JWT secret

# Start the shared infrastructure
docker compose -f shared/docker-compose.shared.yml up -d
```

### 2. Configure & Start Backend

```bash
cd dashboard/backend

cp .env.example .env
nano .env  # DEPLOYMENT_MODE=local is the safe default

npm install
npm run build
npm start
```

### 3. Configure & Start Frontend

```bash
cd dashboard/frontend

cp .env.example .env

npm install
npm run dev
```

Dashboard available at `http://localhost:5173`.

> When creating instances locally, `DEPLOYMENT_MODE=local` automatically skips Nginx domain configuration and binds ports directly to localhost.

---

## ⚙️ Environment Files

### `dashboard/backend/.env`

Copied from `dashboard/backend/.env.example`:

```bash
# Server port — dashboard backend listens here
PORT=3001
NODE_ENV=development  # change to "production" on a VPS

# ─── DEPLOYMENT MODE ──────────────────────────────────────────────────────────
# local  → no nginx config generated, services accessible on localhost:<port>
# cloud  → nginx configs with domain + SSL are generated automatically
DEPLOYMENT_MODE=local

# ─── DATABASE ─────────────────────────────────────────────────────────────────
DATABASE_URL="file:./data/multibase.db"  # SQLite — no external DB needed

# ─── DOCKER ───────────────────────────────────────────────────────────────────
# Linux (default):
# DOCKER_SOCKET_PATH=/var/run/docker.sock
# Windows Docker Desktop (named pipe):
DOCKER_HOST=npipe:////./pipe/docker_engine

# ─── PATHS ────────────────────────────────────────────────────────────────────
PROJECTS_PATH=../../projects  # relative path from dashboard/backend/

# ─── SECURITY ─────────────────────────────────────────────────────────────────
# Must be at least 32 characters — change before going to production!
SESSION_SECRET=your-secret-key-change-in-production-min-32-chars

# ─── CORS ─────────────────────────────────────────────────────────────────────
# Add all origins that should be allowed to call the API
CORS_ORIGIN=http://localhost:5173

# ─── APP URLs ─────────────────────────────────────────────────────────────────
APP_URL=http://localhost:5173
DASHBOARD_URL=http://localhost:5173
BACKEND_URL=http://localhost:3001

# ─── CLOUD-ONLY (DEPLOYMENT_MODE=cloud) ───────────────────────────────────────
# BACKEND_DOMAIN=backend.example.com
# ROOT_DOMAIN=example.com
# FRONTEND_DOMAIN=app.example.com
# COOKIE_DOMAIN=.example.com  # enables cross-subdomain auth for instances

# ─── SMTP (optional — can also be configured in Dashboard Settings UI) ────────
# SMTP_HOST=smtp.example.com
# SMTP_PORT=587
# SMTP_USER=your-smtp-user
# SMTP_PASS=your-smtp-password
# SMTP_FROM="Multibase" <noreply@example.com>
```

### `dashboard/frontend/.env`

Copied from `dashboard/frontend/.env.example`. Minimal:

```bash
VITE_PORT=5173
# Must point to the backend — change to your VPS IP/domain in production
VITE_API_URL=http://localhost:3001
```

### `shared/.env.shared`

Copied from `shared/.env.shared.example`. Controls the shared infrastructure:

```bash
# ─── SHARED POSTGRESQL ────────────────────────────────────────────────────────
# Change this password before first start — used by all tenant databases
SHARED_POSTGRES_PASSWORD=CHANGE_THIS_BEFORE_FIRST_START
SHARED_PG_PORT=5432

# Must be at least 32 characters — used to sign all per-tenant JWTs
SHARED_JWT_SECRET=CHANGE_THIS_BEFORE_FIRST_START_MIN_32_CHARS
SHARED_JWT_EXPIRY=3600

# ─── SHARED STUDIO/KONG KEYS ──────────────────────────────────────────────────
# Pre-generated for local dev. Replace on a production VPS.
SHARED_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
SHARED_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...

# ─── STUDIO ───────────────────────────────────────────────────────────────────
SHARED_STUDIO_PORT=3000
SHARED_DASHBOARD_USERNAME=supabase       # Supabase Studio login
SHARED_DASHBOARD_PASSWORD=supabase_local_dev  # Change in production!
SHARED_PUBLIC_URL=http://localhost:8000  # External URL of the Nginx Gateway

# ─── ANALYTICS ────────────────────────────────────────────────────────────────
SHARED_ANALYTICS_PORT=4000

# ─── CONNECTION POOLER ────────────────────────────────────────────────────────
SHARED_POOLER_PORT=6543
SHARED_POOLER_POOL_SIZE=50
SHARED_POOLER_MAX_CONN=500

# ─── DOCKER SOCKET ────────────────────────────────────────────────────────────
# Linux:                 /var/run/docker.sock
# Windows/Mac Desktop:   check Docker Desktop settings
DOCKER_SOCKET_LOCATION=/var/run/docker.sock

# ─── NGINX BIND HOST (see "Port Binding" section below) ───────────────────────
# Linux:                 127.0.0.1  (loopback only — more secure)
# Windows/Docker Desktop: 0.0.0.0  (must be reachable from host)
NGINX_BIND_HOST=127.0.0.1
```

---

## ⚠️ Port Binding: Linux vs. Windows / Docker Desktop

The `nginx-gateway` uses a `docker-compose.override.yml` (auto-generated by `setup_shared.py`) to manage all tenant port bindings. The bind address is controlled by a single variable in `shared/.env.shared`:

```bash
# Linux — loopback only (more secure, recommended for VPS)
NGINX_BIND_HOST=127.0.0.1

# Windows / Docker Desktop — must be 0.0.0.0 to be reachable from the host
NGINX_BIND_HOST=0.0.0.0
```

After changing this value, apply it with:

```bash
cd shared
docker compose -f docker-compose.shared.yml -f docker-compose.override.yml --env-file .env.shared up -d --no-deps nginx-gateway
```

> **Why this matters:** `docker-compose.shared.yml` defines the main gateway port `8000`. All tenant-specific ports (e.g. `8786`, `8091`) live **only** in the override file. If the same port gets bound twice with conflicting addresses, Docker raises `address already in use` and the gateway fails to start. Never add `NGINX_PORT_N` entries directly to `docker-compose.shared.yml`.

---

## 🤖 MCP Server Quick-Start

Multibase v1.7 ships a built-in **MCP Server** (Model Context Protocol, JSON-RPC 2.0) that exposes 12 management tools to AI assistants like Claude Desktop, Cursor, or VS Code Copilot.

Add to your MCP client config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "multibase": {
      "url": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

**Available tools:** `list_instances` · `get_instance` · `create_instance` · `start_instance` · `stop_instance` · `delete_instance` · `get_instance_logs` · `create_backup` · `list_backups` · `restore_backup` · `execute_sql` · `system_overview`

For full documentation see [Features v1.7 →](Markdowns/Readme1_7_Feature.md)

---

## 🧪 Testprojekt / System Checker

The [`Testprojekt/`](Testprojekt/) folder contains an **interactive test web app** that verifies all core Multibase features end-to-end:

| Area                | Tests | What it checks                                                                            |
| :------------------ | :---: | :---------------------------------------------------------------------------------------- |
| **MCP Connection**  |   5   | Server info, tool listing, tool calls (`list_instances`, `get_instance`), system overview |
| **Database (CRUD)** |   6   | Create table → Insert → Read → Update → Delete → Cleanup                                  |
| **Storage**         |   6   | Create bucket → Upload → List → Download+Verify → Public URL → Cleanup                    |
| **Edge Functions**  |   3   | List functions, invoke main function, fetch logs                                          |
| **Realtime**        |   4   | Fetch config/stats, subscribe+broadcast test, connection info                             |

Quick start:

```bash
cd Testprojekt
cp backend/.env.example backend/.env
# Set MULTIBASE_API_URL, MULTIBASE_TOKEN, and INSTANCE_NAME in backend/.env
npm run install:all
npm run dev
# Open http://localhost:5173
```

See [Testprojekt/README.md](Testprojekt/README.md) for full setup instructions.

---

## 📚 Documentation Library

### Features & Roadmap (`/Markdowns`)

| Document                                                    | Description                                              |    Status    |
| :---------------------------------------------------------- | :------------------------------------------------------- | :----------: |
| [Feature Guide v1.0](Markdowns/README.md)                   | Complete manual for the initial production version       |  ✅ Active   |
| [Features v1.1](Markdowns/Readme1_1_feature.md)             | User Mgmt, Alerts, Backups, Security, Templates, SMTP    | ✅ Released  |
| [Features v1.2](Markdowns/Readme1_2_Feature.md)             | Storage Manager, Advanced Monitoring, Instance Cloning   | ✅ Released  |
| [Features v1.3](Markdowns/Readme1_3_Feature.md)             | AI Chat, Cloud Arch, Kong→Nginx, Workspace               | ✅ Released  |
| [Features v1.4](Markdowns/Readme1_4_Feature.md)             | Multi-Tenancy, Organisations, Role-Based Access          | ✅ Released  |
| [Features v1.5](Markdowns/Readme1_5_Feature.md)             | GraphQL Playground, Webhooks, Cron, pgvector, pgmq       | ✅ Released  |
| [Features v1.6](Markdowns/Readme1_6_Feature.md)             | Custom Domains, Vault, Network Restrictions, Tus Upload  | ✅ Released  |
| [Features v1.7](Markdowns/Readme1_7_Feature.md)             | Functions IDE, Read Replicas, Log Drains, MCP Server     | ✅ Released  |
| [Feature Roadmap v2.0+](Markdowns/4.0.0_Feature_Roadmap.md) | Multi-Region, GitOps, AI Advisor, White-Label, Branching |  🔮 Planned  |
| [Cloud Architecture](Markdowns/CLOUD_ARCHITECTURE.md)       | Shared Infra design & implementation log (Phase 0–8)     | 📐 Reference |
| [Kong→Nginx Migration](Markdowns/KONG_NGINX_MIGRATION.md)   | Complete migration plan & post-migration status          |   ✅ Done    |
| [AI Chat Agent](Markdowns/AIchat.md)                        | Deep-dive: AI assistant with 30+ tools & multi-provider  |   🤖 Tech    |
| [Version Overview](Markdowns/VERSION_OVERVIEW.md)           | High-level summary of the update strategy                |   ℹ️ Info    |
| [Scripts Reference](Markdowns/SCRIPTS.md)                   | Guide to the maintenance scripts in the root directory   |   🔧 Tech    |

### Deployment & Operations

| Document                                              | Description                                             |
| :---------------------------------------------------- | :------------------------------------------------------ |
| [Deployment Guide](deployment/README.md)              | Primary manual for automated server installation        |
| [AWS Deployment](docs/AWS_DEPLOYMENT.md)              | Specific guide for AWS VPC/EC2 setups                   |
| [Port Reference](docs/PORT_REFERENCE.md)              | Complete list of all TCP/UDP ports used by the stack    |
| [Realtime Config](docs/REALTIME_CONFIG.md)            | Deep dive into WebSocket/Realtime service configuration |
| [Troubleshooting](docs/TROUBLESHOOTING.md)            | Solutions for common Docker, Kong, and Database issues  |
| [Cleanup Guide](Markdowns/CLEANUP_RECOMMENDATIONS.md) | Best practices for removing unused orphans and volumes  |

---

## 🤝 Contributing

Contributions are welcome!

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'feat: add your feature'`
4. Push to your branch: `git push origin feature/your-feature`
5. Open a Pull Request

For bug reports and feature ideas, use [GitHub Issues](https://github.com/skipper159/multibase2/issues) or post feedback at [multibase.tyto-design.de](https://multibase.tyto-design.de).

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
