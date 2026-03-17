# Multibase v1.5 — Extension Marketplace

**Status:** 📋 Planned  
**Target Release:** Q3 2026  
**Use Case:** Browse, install, and manage PostgreSQL extensions, integration packs, and community templates directly from the Multibase dashboard

---

## 🎯 Vision

A built-in marketplace that lets users extend their Supabase instances with one click. Admins and team members browse a curated catalog of PostgreSQL extensions, pre-built integration packs, and shared instance templates — and install them without touching the command line.

---

## 📦 Extension Categories

### 1. PostgreSQL Extensions

Pre-vetted database extensions installable per instance via `CREATE EXTENSION`.

| Extension       | Description                              | Version |
| :-------------- | :--------------------------------------- | :------ |
| `pgvector`      | Vector similarity search for AI/ML       | 0.7+    |
| `postgis`       | Geospatial data & queries                | 3.4+    |
| `timescaledb`   | Time-series data management              | 2.15+   |
| `pg_cron`       | Job scheduling inside PostgreSQL         | 1.6+    |
| `pg_stat_statements` | Query performance analytics         | built-in|
| `uuid-ossp`     | UUID generation functions                | built-in|
| `pg_trgm`       | Trigram-based fuzzy text search          | built-in|
| `unaccent`      | Text search without accents              | built-in|

### 2. Integration Packs

Pre-configured service integrations deployed as Edge Functions + env variables.

| Pack          | Description                                        |
| :------------ | :------------------------------------------------- |
| Stripe        | Payment processing webhooks + customer sync        |
| Resend/SendGrid | Transactional email via Edge Functions            |
| Twilio        | SMS / WhatsApp notifications                       |
| Slack         | Webhook-based alerts and notifications             |
| GitHub OAuth  | Social login with GitHub via GoTrue                |
| Google OAuth  | Social login with Google via GoTrue                |

### 3. Community Templates

Shared instance templates contributed by the community, similar to existing instance templates but publicly browsable.

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Frontend                                                    │
│  ┌──────────────────────┐   ┌──────────────────────────────┐ │
│  │  MarketplacePage     │   │  ExtensionDetailModal        │ │
│  │  - Category filters  │   │  - Readme / changelog        │ │
│  │  - Search            │   │  - Install / Uninstall btn   │ │
│  │  - ExtensionCard     │   │  - Instance selector         │ │
│  └──────────┬───────────┘   └──────────────┬───────────────┘ │
│             │                              │                 │
│             └──────────┬───────────────────┘                 │
└────────────────────────┼────────────────────────────────────┘
                         │ REST
┌────────────────────────▼────────────────────────────────────┐
│  Backend                                                    │
│  ┌─────────────────────────┐  ┌──────────────────────────┐  │
│  │ marketplace.ts (Routes) │  │ MarketplaceService.ts    │  │
│  │  GET  /extensions       │  │  - loadCatalog()         │  │
│  │  GET  /extensions/:id   │  │  - installExtension()    │  │
│  │  POST /install          │  │  - uninstallExtension()  │  │
│  │  POST /uninstall        │  │  - getInstalled()        │  │
│  │  GET  /installed        │  └────────────┬─────────────┘  │
│  └─────────────────────────┘               │               │
│                                            │               │
│  ┌─────────────────────────────────────────▼─────────────┐  │
│  │ Existing Services                                     │  │
│  │  DockerManager  InstanceManager  BackupService        │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

Extension Catalog (JSON / DB)
  catalog.json  ←  version-controlled, auto-loaded on startup
```

---

## 🔧 Backend Changes

### New API Routes

```
GET    /api/marketplace/extensions              List all catalog entries (filterable by category)
GET    /api/marketplace/extensions/:id         Get extension details
POST   /api/marketplace/install                Install extension on an instance
POST   /api/marketplace/uninstall              Uninstall extension from an instance
GET    /api/marketplace/installed/:instanceName List installed extensions per instance
```

### Extension Catalog Format

```json
{
  "id": "pgvector",
  "name": "pgvector",
  "category": "postgresql",
  "description": "Vector similarity search for AI/ML workloads.",
  "version": "0.7.0",
  "author": "pgvector",
  "repositoryUrl": "https://github.com/pgvector/pgvector",
  "installCommand": "CREATE EXTENSION IF NOT EXISTS vector;",
  "uninstallCommand": "DROP EXTENSION IF EXISTS vector;",
  "requiresRestart": false,
  "tags": ["ai", "vector", "search"]
}
```

### Prisma Schema Additions

```prisma
model InstalledExtension {
  id            String    @id @default(uuid())
  instanceName  String
  extensionId   String
  installedAt   DateTime  @default(now())
  installedBy   String    // userId
  version       String

  @@unique([instanceName, extensionId])
}
```

### MarketplaceService Logic

**`installExtension(instanceName, extensionId, userId)`**

1. Load extension definition from catalog
2. Validate instance exists and is running
3. Create a backup (safety net before schema changes)
4. Execute `installCommand` via existing `execute_sql` tooling
5. Record installation in `InstalledExtension` table
6. Return `{ success: true, extension, instanceName }`

**`uninstallExtension(instanceName, extensionId, userId)`**

1. Look up installed record
2. Execute `uninstallCommand` via `execute_sql`
3. Remove record from `InstalledExtension`
4. Return `{ success: true }`

---

## 🖥️ Frontend Changes

### New Page: `/marketplace`

```
┌──────────────────────────────────────────────────────────┐
│  🛒 Extension Marketplace                                │
│                                                          │
│  [ 🔍 Search extensions... ]  [ Category ▼ ]            │
│                                                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐         │
│  │ pgvector   │  │ PostGIS    │  │ Stripe Pack│         │
│  │ ⭐ AI/ML   │  │ ⭐ Geo     │  │ ⭐ Payment │         │
│  │ v0.7.0     │  │ v3.4.0     │  │ v1.0.0     │         │
│  │ [Install]  │  │ [Install]  │  │ [Install]  │         │
│  └────────────┘  └────────────┘  └────────────┘         │
└──────────────────────────────────────────────────────────┘
```

### Extension Detail Modal

- Extension name, description, version, author link
- Compatible instance selector (dropdown)
- **Install** / **Uninstall** button (with confirmation for uninstall)
- Installation status badge per instance
- Changelog / README preview

### Modified Pages

- **Sidebar/Navbar**: Add "Marketplace" link (icon: 🛒)
- **Workspace Page**: "Installed Extensions" tab per instance showing installed list + quick uninstall

### New React Hooks (`useMarketplace.ts`)

```typescript
useExtensions(category?: string)       // List catalog entries
useExtension(id: string)               // Single extension detail
useInstalledExtensions(instanceName)   // Installed list per instance
useInstallExtension()                  // Mutation: install
useUninstallExtension()                // Mutation: uninstall
```

---

## 🗄️ Database Schema

```prisma
model InstalledExtension {
  id            String    @id @default(uuid())
  instanceName  String
  extensionId   String
  installedAt   DateTime  @default(now())
  installedBy   String
  version       String

  @@unique([instanceName, extensionId])
}
```

**Migration:** `20260601000000_add_extension_marketplace`

---

## 🔒 Security

| Concern                  | Implementation                                             |
| :----------------------- | :--------------------------------------------------------- |
| **SQL Injection**        | `installCommand` / `uninstallCommand` are catalog-defined, not user input |
| **Permissions**          | Only `owner` / `admin` roles can install; `viewer` cannot |
| **Pre-install Backup**   | Automatic backup before any extension install            |
| **Catalog Integrity**    | Catalog JSON is version-controlled and loaded read-only at startup |
| **Audit Log**            | Every install/uninstall is written to the existing audit log |

---

## 🗺️ Implementation Phases

### Phase 1 — Core Infrastructure (Est. 3–4 days)

- [ ] Create `catalog.json` with initial 8 PostgreSQL extensions
- [ ] Prisma schema: `InstalledExtension` model
- [ ] Migration: `20260601000000_add_extension_marketplace`
- [ ] `MarketplaceService.ts`: `loadCatalog()`, `installExtension()`, `uninstallExtension()`, `getInstalled()`
- [ ] Backend routes: `marketplace.ts` (5 endpoints)
- [ ] Mount `/api/marketplace` in `server.ts`
- [ ] Unit tests for `MarketplaceService`

### Phase 2 — Frontend (Est. 3–4 days)

- [ ] `useMarketplace.ts`: 5 React Query hooks
- [ ] `MarketplacePage.tsx`: Grid view with search + category filter
- [ ] `ExtensionDetailModal.tsx`: Details, instance selector, install/uninstall button
- [ ] Add "Marketplace" entry to sidebar navigation
- [ ] "Installed Extensions" tab in Workspace Page per instance

### Phase 3 — Integration Packs (Est. 2–3 days)

- [ ] Extend catalog with integration pack entries (Stripe, Resend, Twilio, etc.)
- [ ] `IntegrationPackInstaller.ts`: deploys Edge Functions + sets env variables
- [ ] Frontend: differentiated UI for integration packs vs. DB extensions

### Phase 4 — Community Templates (Est. 2–3 days)

- [ ] Public template browsing endpoint (read-only, no auth required for listing)
- [ ] Template detail page with one-click "Create Instance from Template"
- [ ] Submit template flow (admin-reviewed before publishing)

---

## 📂 File Overview

```
dashboard/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma                         # InstalledExtension model
│   │   └── migrations/
│   │       └── 20260601000000_add_extension_marketplace/
│   │           └── migration.sql
│   ├── src/
│   │   ├── routes/marketplace.ts                 # 5 REST endpoints
│   │   ├── services/MarketplaceService.ts        # Install/uninstall logic
│   │   └── data/catalog.json                     # Extension catalog
│   └── server.ts                                 # Mount /api/marketplace
│
└── frontend/
    └── src/
        ├── pages/MarketplacePage.tsx             # Main marketplace UI
        ├── components/ExtensionDetailModal.tsx   # Detail + install modal
        └── hooks/useMarketplace.ts               # React Query hooks
```

---

## 🔮 Future Extensions (v1.6+)

- **Community Submissions** — Pull-request-based catalog contributions via GitHub
- **Extension Ratings & Reviews** — User feedback per extension
- **Auto-Update Notifications** — Alert when a newer extension version is available
- **Dependency Resolution** — Auto-install required extensions before target extension
- **Private Catalog** — Organisation-scoped private extensions (v1.4 Multi-Tenancy required)

---

*Part of the Multibase roadmap. See [VERSION_OVERVIEW.md](./VERSION_OVERVIEW.md) for full roadmap.*
