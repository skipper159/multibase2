---
title: Version 2.0 - Platform Maturity
description: Terraform Provider, Management SDK, Extension Marketplace, Multi-Region Deployment
---

# Version 2.0 — Platform Maturity

**Status:** 🚧 In Planning  
**Planned Release:** Q3 2026  
**Use Case:** Infrastructure-as-Code, programmatic access, extensibility, and global scale

---

## 🎯 Overview

v2.0 transforms Multibase from a self-hosted dashboard into a **full developer platform**. Infrastructure can be declared as code, all features are accessible programmatically via an official SDK, third-party extensions can be installed from a marketplace, and projects can be deployed across multiple regions.

| # | Feature | Location | Priority |
|---|---------|----------|----------|
| 1 | Terraform Provider / Infrastructure as Code | External Terraform registry | High |
| 2 | Management SDK (TypeScript + Python) | npm / PyPI packages | High |
| 3 | Extension Marketplace | `/settings/marketplace` | Medium |
| 4 | Multi-Region Deployment | Global `/settings/regions` | Medium |

---

## 🔧 CLI — Status

> **Already implemented** — The Multibase CLI (`supabase_manager.py`) is a **custom Python 3 tool** (519 lines) built specifically for this project. It is **not** part of the Supabase stack.

**Available commands:**

```bash
# Shared Infrastructure
python supabase_manager.py shared-start     # Start 8 shared services
python supabase_manager.py shared-stop      # Stop shared services
python supabase_manager.py shared-status    # Show status

# Tenant Management
python supabase_manager.py create <name> --base-port <port>  # Create tenant
python supabase_manager.py start <name> [--verbose]          # Start tenant
python supabase_manager.py stop <name> [--keep-volumes]      # Stop tenant
python supabase_manager.py reset <name>                      # Reset tenant
python supabase_manager.py status <name>                     # Check status
python supabase_manager.py list                              # List all tenants
```

**Supporting files:**
- `supabase_manager.py` — Main CLI entry point
- `supabase_setup.py` — Per-tenant Docker Compose generator with JWT/credentials
- `setup_shared.py` — Shared infrastructure bootstrap

The CLI can be extended in v2.0 to wrap the new Management SDK for a richer developer experience.

---

## 📦 Workspace Sidebar (v2.0)

```
/settings
  ├── /settings/mcp         (v1.7 — MCP Server config)
  ├── /settings/marketplace  (v2.0 — Extension Marketplace)
  └── /settings/regions      (v2.0 — Multi-Region management)
```

---

## 🏗️ Terraform Provider

**Priority:** High  
**Effort:** High

### Description

A Terraform provider for Multibase enables **Infrastructure-as-Code** workflows. Developers declare Multibase instances, organisations, API keys, and configuration in HCL — exactly like Supabase's official Terraform provider.

### Key Resources

```hcl
# Example: Declare a production Multibase instance
resource "multibase_instance" "production" {
  name  = "my-app-prod"
  label = "production"

  config {
    smtp_host = "smtp.example.com"
    smtp_port = 587
  }
}

resource "multibase_api_key" "ci_key" {
  name        = "ci-deploy"
  instance_id = multibase_instance.production.id
  permissions = ["read", "backup"]
}

resource "multibase_custom_domain" "app_domain" {
  instance_id = multibase_instance.production.id
  domain      = "api.myapp.com"
}
```

### Provider Resources

| Resource | Description |
|----------|-------------|
| `multibase_instance` | Create / configure a tenant instance |
| `multibase_organisation` | Manage organisations and members |
| `multibase_api_key` | Create scoped API keys |
| `multibase_custom_domain` | Register custom domains |
| `multibase_backup_schedule` | Configure scheduled backups |
| `multibase_network_restriction` | IP whitelist / rate limit rules |
| `multibase_vault_secret` | Manage Vault secrets |

### Data Sources

| Data Source | Description |
|-------------|-------------|
| `multibase_instance` | Read existing instance details |
| `multibase_organisation` | Read org details |
| `multibase_api_keys` | List API keys for an instance |

### Implementation Plan

1. **Phase 1** — Provider scaffold using `terraform-plugin-framework`
   - CRUD for `multibase_instance`
   - CRUD for `multibase_api_key`
   - Authentication via API key (`MULTIBASE_API_KEY` env var)

2. **Phase 2** — Full resource coverage
   - All resources listed above
   - Import support (`terraform import`)
   - State drift detection

3. **Phase 3** — Registry & documentation
   - Publish to Terraform Registry
   - Full documentation with examples
   - GitHub Actions CI for acceptance tests

### API Endpoints Required

All Terraform operations use the existing Management API. No new backend endpoints needed beyond the Management SDK endpoints (see below).

---

## 🛠️ Management SDK (TypeScript + Python)

**Priority:** High  
**Effort:** Medium

### Description

Official SDKs for **programmatic access** to the Multibase Management API. Enables automation, CI/CD pipelines, and third-party integrations without shell scripting.

### TypeScript SDK (`@multibase/sdk`)

```typescript
import { MultibaseClient } from '@multibase/sdk';

const client = new MultibaseClient({
  url: 'https://your-multibase-host',
  apiKey: process.env.MULTIBASE_API_KEY,
});

// Instance management
const instances = await client.instances.list();
const instance  = await client.instances.create({ name: 'my-app', label: 'production' });
await client.instances.start('my-app');
await client.instances.stop('my-app');

// Backups
const backup = await client.backups.create('my-app');
await client.backups.restore('my-app', backup.id);

// Metrics
const metrics = await client.metrics.get('my-app');
console.log(metrics.cpu, metrics.memory);

// SQL (read-only)
const result = await client.sql.query('my-app', 'SELECT count(*) FROM users');
```

**Package:** `@multibase/sdk` on npm  
**Supported environments:** Node.js 18+, browser (limited), Deno

### Python SDK (`multibase-sdk`)

```python
from multibase import MultibaseClient

client = MultibaseClient(
    url="https://your-multibase-host",
    api_key=os.environ["MULTIBASE_API_KEY"],
)

# Instance management
instances = client.instances.list()
client.instances.create(name="my-app", label="production")
client.instances.start("my-app")

# Backups
backup = client.backups.create("my-app")
client.backups.restore("my-app", backup_id=backup.id)

# Metrics
metrics = client.metrics.get("my-app")
print(metrics.cpu, metrics.memory)
```

**Package:** `multibase-sdk` on PyPI  
**Supported versions:** Python 3.9+

### SDK Modules

| Module | Methods |
|--------|---------|
| `instances` | `list()`, `get()`, `create()`, `start()`, `stop()`, `restart()`, `delete()`, `clone()` |
| `backups` | `list()`, `create()`, `restore()`, `delete()` |
| `storage` | `listBuckets()`, `createBucket()`, `uploadObject()`, `getSignedUrl()` |
| `metrics` | `get()`, `history()` |
| `logs` | `get()`, `stream()` |
| `sql` | `query()` |
| `apiKeys` | `list()`, `create()`, `revoke()` |
| `organisations` | `list()`, `get()`, `create()`, `inviteMember()` |
| `functions` | `list()`, `deploy()`, `invoke()`, `getLogs()` |

### New Backend Endpoints

```
GET  /api/management/v1/instances           # List all instances (org-scoped)
GET  /api/management/v1/instances/:name     # Get instance details
POST /api/management/v1/instances           # Create instance
POST /api/management/v1/instances/:name/start
POST /api/management/v1/instances/:name/stop
DELETE /api/management/v1/instances/:name
GET  /api/management/v1/instances/:name/metrics
GET  /api/management/v1/instances/:name/logs
POST /api/management/v1/instances/:name/sql
```

> Note: These are versioned `/v1/` endpoints that wrap existing routes for SDK stability guarantees.

### Implementation Plan

1. **Phase 1** — TypeScript SDK
   - Scaffold with `tsup` build tool
   - Auth, Instances, Backups, Metrics modules
   - Full TypeScript types generated from OpenAPI spec
   - Publish to npm

2. **Phase 2** — Python SDK
   - Scaffold with `poetry`
   - Same module coverage as TypeScript
   - Async support (`asyncio`)
   - Publish to PyPI

3. **Phase 3** — OpenAPI spec + Docs
   - Generate OpenAPI 3.1 spec from existing routes
   - Swagger UI on `/api/docs`
   - SDK reference documentation site

---

## 🧩 Extension Marketplace

**Priority:** Medium  
**Effort:** Medium

### Description

A curated marketplace where users can install **pre-built extensions** — database templates, Edge Function starters, Auth configurations, and monitoring integrations — with one click.

### Key Features

- **Browse Extensions**: Filter by category (Database, Auth, Storage, Functions, Monitoring)
- **One-Click Install**: Extensions are installed into a specific instance with a wizard
- **Extension Types**: SQL templates, Edge Function packages, Docker add-ons, config presets
- **Community + Official**: Verified official extensions + community submissions
- **Version Management**: Extension versioning with upgrade/rollback

### Extension Categories

| Category | Examples |
|----------|---------|
| **Database Templates** | E-commerce schema, Blog schema, SaaS starter, Multi-tenant template |
| **Auth Configs** | Social login presets, Enterprise SSO templates, CAPTCHA setups |
| **Edge Functions** | Stripe webhooks, Resend email, Slack notifications, PDF generation |
| **Monitoring** | Grafana dashboard import, Datadog integration, Sentry DSN setup |
| **AI/Vectors** | pgvector starter schema, Embedding pipeline, RAG template |

### Extension Manifest (`multibase.extension.json`)

```json
{
  "id": "ecommerce-starter",
  "name": "E-Commerce Starter Schema",
  "description": "Complete PostgreSQL schema for e-commerce: products, orders, customers, inventory",
  "version": "1.2.0",
  "author": "Multibase",
  "category": "database",
  "verified": true,
  "install": {
    "type": "sql",
    "files": ["schema.sql", "seed.sql"],
    "rollback": "rollback.sql"
  },
  "requirements": {
    "minVersion": "1.5.0",
    "extensions": ["pgcrypto", "uuid-ossp"]
  }
}
```

### New Prisma Model

```prisma
model InstalledExtension {
  id          String   @id @default(uuid())
  instanceId  String
  extensionId String
  version     String
  installedAt DateTime @default(now())
  status      String   @default("active")
  instance    Instance @relation(fields: [instanceId], references: [id], onDelete: Cascade)

  @@unique([instanceId, extensionId])
}
```

### API Routes

```
GET    /api/marketplace/extensions           # List all available extensions
GET    /api/marketplace/extensions/:id       # Get extension details
POST   /api/instances/:name/extensions       # Install extension
GET    /api/instances/:name/extensions       # List installed extensions
DELETE /api/instances/:name/extensions/:id   # Uninstall extension
```

### UI Location

- **Global**: `/settings/marketplace` — Browse and discover extensions
- **Per-Instance**: Extensions tab in the Workspace sidebar (after `log-drains`)

### Implementation Plan

1. **Phase 1** — Static marketplace with 5 official extensions
   - Schema: `InstalledExtension` model
   - Backend: Install/uninstall endpoints
   - Frontend: Marketplace browser + install wizard

2. **Phase 2** — Extension SDK for community developers
   - `multibase-extension` CLI scaffold tool
   - Validation and submission pipeline
   - Extension registry API

3. **Phase 3** — Auto-updates and dependency resolution
   - Background update checker
   - Dependency graph for complex extensions

---

## 🌍 Multi-Region Deployment

**Priority:** Medium  
**Effort:** High

### Description

Deploy Multibase instances in **multiple geographic regions** to reduce latency for global users. Supports primary/replica topology with automatic failover.

### Key Features

- **Region Selection**: Choose deployment region at instance creation
- **Regional Dashboard**: Overview of all instances grouped by region
- **Latency Monitor**: Real-time latency measurements between regions
- **Cross-Region Replication**: Builds on v1.7 Read Replicas
- **Failover Management**: Manual and automatic primary promotion

### Supported Regions (initial)

| Region ID | Location | Provider |
|-----------|----------|----------|
| `eu-west-1` | Frankfurt, Germany | Self-hosted / Hetzner |
| `us-east-1` | New York, USA | Self-hosted / AWS |
| `ap-southeast-1` | Singapore | Self-hosted / DigitalOcean |
| `custom` | User-defined VPS | Bring Your Own |

### New Prisma Models

```prisma
model Region {
  id        String     @id @default(uuid())
  name      String     @unique
  location  String
  apiUrl    String
  status    String     @default("active")
  createdAt DateTime   @default(now())
  instances Instance[]
}
```

### API Routes

```
GET  /api/regions                      # List available regions
POST /api/regions                      # Register a new region (admin)
GET  /api/regions/:id/status           # Region health check
GET  /api/instances/:name/region       # Get instance region
POST /api/instances/:name/migrate-region  # Migrate instance to new region
```

### Implementation Plan

1. **Phase 1** — Region awareness
   - Add `regionId` field to `Instance` model
   - Region management UI in admin settings
   - Display region badge on instance cards

2. **Phase 2** — Multi-node deployment
   - Multibase control plane → agent architecture
   - Agent installed on each regional node
   - Control plane routes API calls to correct agent

3. **Phase 3** — Geo-routing and failover
   - DNS-based geo-routing
   - Automatic failover on region outage
   - Cross-region replication UI (extends v1.7 Read Replicas)

---

## 📊 Effort / Impact Matrix

| # | Feature | Impact | Effort | Priority |
|---|---------|--------|--------|----------|
| 1 | Terraform Provider | 🔴 Hoch | 🔴 Hoch | High |
| 2 | Management SDK (TS + Python) | 🔴 Hoch | 🟡 Mittel | High |
| 3 | Extension Marketplace | 🟡 Mittel | 🟡 Mittel | Medium |
| 4 | Multi-Region Deployment | 🟡 Mittel | 🔴 Hoch | Medium |

---

## 🗓️ Release Schedule

### v2.0-alpha (Month 1–2)
- [ ] Management SDK TypeScript (core modules: instances, backups, metrics)
- [ ] OpenAPI 3.1 spec generated from existing routes
- [ ] `/api/management/v1/` versioned endpoints

### v2.0-beta (Month 3–4)
- [ ] Management SDK Python
- [ ] Extension Marketplace (static, 5 official extensions)
- [ ] Terraform Provider (instances + API keys)
- [ ] Region model + region badge on instance cards

### v2.0 (Month 5–6)
- [ ] Terraform Provider full resource coverage + Terraform Registry publish
- [ ] SDK packages on npm + PyPI
- [ ] Extension SDK for community developers
- [ ] Multi-node architecture proof of concept

---

*Created: March 2026 | Status: In Planning*
