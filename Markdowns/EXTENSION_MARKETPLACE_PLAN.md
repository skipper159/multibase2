# Extension Marketplace — Implementierungsplan

> Detaillierter Frontend & Backend Implementationsplan für den Multibase Extension Marketplace.  
> Stand: März 2026 | Status: 🚧 In Planning (v2.0)

---

## Vision

Der **Multibase Extension Marketplace** ist der App-Store für deine Supabase-Infrastruktur.  
Statt stundenlang Schemas, Edge Functions oder Auth-Konfigurationen manuell einzurichten,  
installierst du eine kuratierte Extension mit einem Klick — und dein Projekt ist sofort einsatzbereit.

> **Analogien:** Shopify App Store · WordPress Plugin Directory · VS Code Extension Marketplace · Vercel Integrations

---

## Überblick

| # | Modul | Platzierung | Aufwand | Priorität |
|---|-------|-------------|---------|-----------|
| 1 | Marketplace Browser | `/settings/marketplace` (global) | Mittel | Hoch |
| 2 | Extension-Installer (per Instanz) | `ExtensionsTab` im Workspace | Mittel | Hoch |
| 3 | Extension Registry (Backend) | `GET /api/marketplace/extensions` | Klein | Hoch |
| 4 | Install-Engine (Backend) | `POST /api/instances/:name/extensions` | Mittel | Hoch |
| 5 | Extension-Manifest-Format | `multibase.extension.json` Spec | Klein | Hoch |
| 6 | Community-Extension-SDK | `multibase-extension` CLI-Tool | Groß | Mittel |
| 7 | Auto-Updates & Versioning | Background Worker | Mittel | Niedrig |

---

## Architektur-Überblick

### Neue Seiten & Tabs

```
/settings/marketplace            ← Globaler Browser (alle Extensions entdecken)
  └── /settings/marketplace/:id  ← Extension-Detailseite

/workspace/projects/:project/extensions  ← Installierte Extensions pro Instanz
```

### Neue Workspace Sidebar (v2.0)

```
/workspace/projects/:project/:tab
  Haupt-Tabs: overview | auth | database | storage | policies |
              functions | webhooks | cron | vectors | queues | api |
              realtime | replicas | log-drains | extensions   ← NEU
  ─── Konfiguration ───
  smtp | keys | domains | vault | security
```

### Neue Prisma-Modelle

```prisma
// Eine Extension-Definition (Katalog — statisch oder aus Registry API)
model Extension {
  id            String   @id  // z.B. "ecommerce-starter"
  name          String
  description   String
  longDescription String?
  version       String
  author        String
  authorUrl     String?
  category      String        // 'database' | 'auth' | 'functions' | 'monitoring' | 'ai' | 'storage'
  tags          String        // komma-separiert: "ecommerce,schema,starter"
  iconUrl       String?
  screenshotUrls String?      // komma-separiert
  verified      Boolean @default(false)
  featured      Boolean @default(false)
  installCount  Int     @default(0)
  rating        Float?
  minVersion    String        // mind. Multibase-Version für Kompatibilität
  requiresExtensions String? // komma-separiert: "pgcrypto,uuid-ossp"
  installType   String        // 'sql' | 'function' | 'config' | 'composite'
  manifestUrl   String        // URL zur multibase.extension.json
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  installations InstalledExtension[]
}

// Eine installierte Extension-Instanz (pro Tenant)
model InstalledExtension {
  id            String   @id @default(uuid())
  instanceId    String
  extensionId   String
  version       String
  status        String   @default("active")   // 'active' | 'error' | 'updating' | 'disabled'
  config        String?                        // JSON: user-defined config values
  installedAt   DateTime @default(now())
  updatedAt     DateTime @updatedAt

  instance      Instance  @relation(fields: [instanceId], references: [id], onDelete: Cascade)
  extension     Extension @relation(fields: [extensionId], references: [id])

  @@unique([instanceId, extensionId])
  @@index([instanceId])
}
```

---

## Extension-Manifest-Format (`multibase.extension.json`)

Jede Extension wird durch eine JSON-Datei beschrieben, die im Git-Repository der Extension liegt.  
Das Format ist angelehnt an VS Code Extension Manifests und npm `package.json`.

```json
{
  "$schema": "https://multibase.dev/schemas/extension/v1.json",
  "id": "ecommerce-starter",
  "name": "E-Commerce Starter",
  "description": "Vollständiges PostgreSQL-Schema für E-Commerce: Produkte, Bestellungen, Kunden, Inventar, Kategorien.",
  "longDescription": "Dieses Schema enthält 12 Tabellen, RLS-Policies, Trigger für Bestandsverwaltung und pgvector-Spalten für Produktempfehlungen. Ideal als Startpunkt für Online-Shops, Marktplätze und Abo-Dienste.",
  "version": "1.3.0",
  "author": "Multibase",
  "authorUrl": "https://github.com/multibase",
  "category": "database",
  "tags": ["ecommerce", "schema", "starter", "pgvector", "rls"],
  "iconUrl": "https://cdn.multibase.dev/extensions/ecommerce-starter/icon.png",
  "screenshotUrls": [
    "https://cdn.multibase.dev/extensions/ecommerce-starter/screen1.png",
    "https://cdn.multibase.dev/extensions/ecommerce-starter/screen2.png"
  ],
  "verified": true,
  "featured": true,
  "requirements": {
    "minMultibaseVersion": "1.5.0",
    "postgresExtensions": ["pgcrypto", "uuid-ossp", "pgvector"]
  },
  "install": {
    "type": "sql",
    "steps": [
      { "label": "Schema erstellen",    "file": "migrations/001_schema.sql" },
      { "label": "RLS-Policies setzen", "file": "migrations/002_rls.sql" },
      { "label": "Seed-Daten einfügen", "file": "migrations/003_seed.sql", "optional": true }
    ],
    "rollback": "rollback.sql",
    "configSchema": {
      "schemaName": {
        "type": "string",
        "default": "public",
        "label": "Ziel-Schema",
        "description": "PostgreSQL-Schema, in das die Tabellen installiert werden."
      },
      "includeSeedData": {
        "type": "boolean",
        "default": true,
        "label": "Demo-Daten einfügen",
        "description": "Fügt Beispielprodukte, Kategorien und einen Demo-Kunden ein."
      }
    }
  },
  "changelog": {
    "1.3.0": "pgvector-Spalte für Produktempfehlungen hinzugefügt",
    "1.2.0": "RLS-Policies für Kunden-Self-Service ergänzt",
    "1.0.0": "Erstes Release"
  }
}
```

### Install-Typen

| Typ | Beschreibung | Beispiel |
|-----|-------------|---------|
| `sql` | SQL-Dateien in der Reihenfolge ausführen | Schema-Templates, RLS-Policies |
| `function` | Edge-Function-Dateien deployen | Webhook-Handler, PDF-Generator |
| `config` | Environment Variables setzen + Container-Restart | Auth-Provider-Preset |
| `composite` | Kombination aus sql + function + config | Full-Stack-Starter |

---

## Kuratierte Startbibliothek (20 offizielle Extensions)

### 🗄️ Kategorie: Datenbank-Templates

| Extension | Beschreibung | Tabellen | Besonderheiten |
|-----------|-------------|---------|----------------|
| **ecommerce-starter** | Online-Shop-Schema | 12 | RLS, pgvector Empfehlungen, Bestandstrigger |
| **blog-cms** | Blog & CMS Schema | 8 | Volltext-Suche, Tag-System, Draft/Published |
| **saas-starter** | SaaS-Plattform Basis | 15 | Org-Model, Subscriptions, Feature-Flags |
| **multi-tenant-base** | Multi-Tenant-Schema-Template | 6 | Row-Level-Isolation, Tenant-Management |
| **audit-trail** | Änderungshistorie für beliebige Tabellen | 3 | Trigger-basiert, auto-Diff, GDPR-ready |
| **address-book** | Adress- und Kontaktverwaltung | 5 | Geocoding-Vorbereitung, vCard-Export |

### 🔐 Kategorie: Auth & Sicherheit

| Extension | Beschreibung | Typ | Besonderheiten |
|-----------|-------------|-----|----------------|
| **social-login-bundle** | Google + GitHub + Discord in einem Klick | `config` | Auto-setzt OAuth ENV Vars, Dokumentation |
| **enterprise-sso** | SAML SSO Konfigurationsvorlage | `config` | Azure AD, Okta, Google Workspace Templates |
| **2fa-enforcement** | Erzwingt 2FA für alle Nutzer | `sql` + `config` | Auth-Hook, Redirect-Logik, UI-Hinweise |
| **rbac-starter** | Rollenbasiertes Berechtigungssystem | `sql` | Roles-Table, Permission-Checks, RLS-Integration |

### ⚡ Kategorie: Edge Functions

| Extension | Beschreibung | Trigger | Drittanbieter |
|-----------|-------------|---------|--------------|
| **stripe-webhooks** | Stripe-Payment-Events verarbeiten | HTTP POST | Stripe API |
| **resend-transactional** | Transaktions-E-Mails über Resend | Datenbank-Webhook | Resend API |
| **slack-notifier** | Slack-Notifications bei DB-Events | Datenbank-Webhook | Slack Webhooks |
| **pdf-generator** | PDFs aus HTML-Templates generieren | HTTP POST | Headless Chrome (via Browserless) |
| **image-optimizer** | Bilder bei Storage-Upload optimieren | Storage-Trigger | Sharp (eingebaut) |
| **ai-embeddings** | Automatische pgvector-Embeddings | Datenbank-Trigger | OpenAI / Cohere / local |

### 📊 Kategorie: Monitoring & Observability

| Extension | Beschreibung | Output |
|-----------|-------------|--------|
| **grafana-dashboard** | Vorgefertigtes Grafana-Dashboard für Multibase | Dashboard JSON Import |
| **sentry-integration** | Fehler aus Edge Functions an Sentry senden | Sentry DSN Config |
| **uptime-kuma** | Uptime Kuma Monitoring-Konfiguration | Monitor-Export JSON |

### 🤖 Kategorie: AI & Vectors

| Extension | Beschreibung | Besonderheiten |
|-----------|-------------|----------------|
| **rag-starter** | RAG-Pipeline: Dokument-Upload → Embedding → Similarity Search | pgvector + Edge Function |
| **semantic-search** | Semantische Suche für beliebige Textspalten | Embedding-Trigger + Search-API |

---

## Backend-Implementierung

### Neue Dateien

```
dashboard/backend/src/
├── routes/
│   ├── marketplace.ts      ← Extension-Katalog-Endpunkte
│   └── extensions.ts       ← Install/Uninstall pro Instanz
└── services/
    └── ExtensionService.ts ← Install-Engine
```

### `marketplace.ts` — Katalog-Endpunkte

```typescript
// GET /api/marketplace/extensions
// Gibt alle verfügbaren Extensions zurück (aus DB + optionalem Remote-Registry-Refresh)
router.get('/', requireViewer, async (req, res) => {
  const { category, search, featured } = req.query;
  // Filter nach Kategorie, Volltextsuche in name/description/tags, featured-Flag
});

// GET /api/marketplace/extensions/:id
// Detailansicht einer Extension inkl. Changelog und Kompatibilitätsprüfung
router.get('/:id', requireViewer, async (req, res) => {
  const { id } = req.params;
  // Extension aus DB holen, Manifest von manifestUrl nachladen (gecacht)
});

// POST /api/marketplace/sync
// Admin-only: Synchronisiert den Extension-Katalog mit dem Remote-Registry
router.post('/sync', requireAdmin, async (req, res) => {
  // Ruft https://registry.multibase.dev/extensions ab (oder lokale JSON-Datei)
  // Upsert aller Extensions in die DB
});
```

### `extensions.ts` — Instanz-Endpunkte

```typescript
// GET /api/instances/:name/extensions
// Gibt alle installierten Extensions für eine Instanz zurück
router.get('/', requireViewer, verifyInstanceOrg, async (req, res) => {
  // Lade alle InstalledExtension für die Instanz inkl. Extension-Details
});

// POST /api/instances/:name/extensions
// Installiert eine Extension auf einer Instanz
router.post('/', requireUser, verifyInstanceOrg, async (req, res) => {
  const { extensionId, config } = req.body;
  // 1. Kompatibilität prüfen (minVersion, requires-Extensions)
  // 2. Extension-Manifest laden
  // 3. Install-Engine aufrufen (ExtensionService.install)
  // 4. InstalledExtension in DB speichern
  // 5. AuditLog schreiben
});

// DELETE /api/instances/:name/extensions/:extensionId
// Deinstalliert eine Extension (führt rollback.sql aus falls vorhanden)
router.delete('/:extensionId', requireUser, verifyInstanceOrg, async (req, res) => {
  // 1. InstalledExtension prüfen (existiert sie?)
  // 2. ExtensionService.uninstall aufrufen
  // 3. InstalledExtension aus DB löschen
});

// GET /api/instances/:name/extensions/:extensionId/status
// Status einer installierten Extension
router.get('/:extensionId/status', requireViewer, verifyInstanceOrg, async (req, res) => {
  // Gibt status, installedAt, version, config zurück
});
```

### `ExtensionService.ts` — Install-Engine

```typescript
export class ExtensionService {
  constructor(
    private prisma: PrismaClient,
    private instanceManager: InstanceManager
  ) {}

  /**
   * Installiert eine Extension auf einer Instanz.
   * Führt alle Schritte des Manifests in der definierten Reihenfolge aus.
   */
  async install(instanceName: string, extension: Extension, config: Record<string, any>): Promise<void> {
    const manifest = await this.loadManifest(extension.manifestUrl);

    // Config validieren (gegen configSchema)
    this.validateConfig(manifest.install.configSchema, config);

    // Postgres-Extensions sicherstellen
    if (manifest.requirements?.postgresExtensions) {
      await this.ensurePostgresExtensions(instanceName, manifest.requirements.postgresExtensions);
    }

    // Install-Schritte ausführen
    for (const step of manifest.install.steps) {
      if (step.optional && config.skip?.[step.label]) continue;

      switch (manifest.install.type) {
        case 'sql':
          const sql = await this.fetchFile(extension.manifestUrl, step.file);
          const interpolated = this.interpolateConfig(sql, config);
          await this.instanceManager.executeSql(instanceName, interpolated);
          break;

        case 'function':
          const code = await this.fetchFile(extension.manifestUrl, step.file);
          await this.instanceManager.deployFunction(instanceName, step.functionName!, code);
          break;

        case 'config':
          await this.instanceManager.setEnvVars(instanceName, step.envVars!);
          break;
      }
    }
  }

  /**
   * Deinstalliert eine Extension (Rollback-SQL ausführen).
   */
  async uninstall(instanceName: string, extension: Extension, installed: InstalledExtension): Promise<void> {
    const manifest = await this.loadManifest(extension.manifestUrl);
    if (manifest.install.rollback) {
      const rollbackSql = await this.fetchFile(extension.manifestUrl, manifest.install.rollback);
      await this.instanceManager.executeSql(instanceName, rollbackSql);
    }
  }

  /**
   * Stellt sicher, dass die benötigten Postgres-Extensions aktiviert sind.
   */
  private async ensurePostgresExtensions(instanceName: string, extensions: string[]): Promise<void> {
    for (const ext of extensions) {
      await this.instanceManager.executeSql(
        instanceName,
        `CREATE EXTENSION IF NOT EXISTS "${ext}";`
      );
    }
  }

  /**
   * Interpoliert Config-Werte in SQL/Config-Dateien.
   * Template-Syntax: {{schemaName}}, {{includeSeedData}}
   */
  private interpolateConfig(template: string, config: Record<string, any>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => config[key] ?? '');
  }

  /**
   * Lädt das Extension-Manifest (gecacht für 1 Stunde in Redis).
   */
  private async loadManifest(manifestUrl: string): Promise<ExtensionManifest> {
    // Cache-First: Redis-Cache prüfen, sonst HTTP-Fetch
    const cached = await this.cache?.get(`manifest:${manifestUrl}`);
    if (cached) return JSON.parse(cached);

    const response = await fetch(manifestUrl);
    const manifest = await response.json();
    await this.cache?.setex(`manifest:${manifestUrl}`, 3600, JSON.stringify(manifest));
    return manifest;
  }
}
```

---

## Frontend-Implementierung

### Neue Dateien

```
dashboard/frontend/src/
├── pages/
│   └── MarketplacePage.tsx            ← Globaler Marketplace-Browser
└── components/
    ├── marketplace/
    │   ├── ExtensionCard.tsx           ← Karten-Komponente für Suchergebnisse
    │   ├── ExtensionDetailModal.tsx    ← Detailansicht + Install-Wizard
    │   ├── ExtensionCategoryFilter.tsx ← Kategorie-Filterleiste
    │   └── InstallWizard.tsx           ← Schritt-für-Schritt Installations-Flow
    └── ExtensionsTab.tsx               ← Installierte Extensions pro Instanz
```

### `MarketplacePage.tsx` — Globaler Browser

```
Layout:
┌─────────────────────────────────────────────────────────────────┐
│  🧩 Extension Marketplace                  [Sync Registry]      │
│  Entdecke und installiere Extensions für deine Supabase-Projekte│
├─────────────────────────────────────────────────────────────────┤
│  🔍 [Suche Extensions...]                                       │
│                                                                  │
│  Alle | 🗄️ Datenbank | 🔐 Auth | ⚡ Functions |                 │
│  📊 Monitoring | 🤖 AI/Vectors | 💾 Storage                     │
├─────────────────────────────────────────────────────────────────┤
│  ⭐ Featured                                                      │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │ 🛒 E-Commerce│ │ ⚡ Stripe    │ │ 🤖 RAG       │            │
│  │   Starter    │ │   Webhooks   │ │   Starter    │            │
│  │ by Multibase │ │ by Multibase │ │ by Multibase │            │
│  │ ⭐ 4.9 | 312 │ │ ⭐ 4.8 | 198│ │ ⭐ 4.7 | 144 │            │
│  │ [Installieren]│ │ [Installieren│ │ [Installieren]           │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│                                                                  │
│  Alle Extensions (20)                           [Sortieren ▾]   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │ ...          │ │ ...          │ │ ...          │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

**State Management:**

```typescript
// useQuery für Extension-Katalog laden
const { data: extensions } = useQuery({
  queryKey: ['marketplace', 'extensions', { category, search }],
  queryFn: () => marketplaceApi.listExtensions({ category, search }),
});

// Lokaler State für Filter/Suche
const [search, setSearch]     = useState('');
const [category, setCategory] = useState<string | null>(null);
```

### `InstallWizard.tsx` — Installations-Flow

Der Install-Wizard führt den Nutzer in 3 Schritten durch die Installation:

```
Schritt 1: Instanz auswählen
  ─────────────────────────────────
  Auf welcher Instanz installieren?
  ┌──────────────────────────────┐
  │ ● my-app-prod  [production]  │
  │ ○ my-app-staging [staging]   │
  │ ○ test-project   [dev]       │
  └──────────────────────────────┘
  [Weiter →]

Schritt 2: Konfiguration
  ─────────────────────────────────
  Extension konfigurieren
  Ziel-Schema: [public ▾]
  Demo-Daten einfügen: [✓]
  [← Zurück] [Installieren]

Schritt 3: Installation
  ─────────────────────────────────
  Installation läuft...
  ✅ Postgres-Extensions sichergestellt
  ✅ Schema erstellt (001_schema.sql)
  ✅ RLS-Policies gesetzt (002_rls.sql)
  ⏳ Seed-Daten werden eingefügt...
  ─────────────────────────────────
  [Fertig ✓] → ExtensionsTab öffnen
```

### `ExtensionsTab.tsx` — Installierte Extensions pro Instanz

```
Layout:
┌─────────────────────────────────────────────────────────────────┐
│  Installierte Extensions                 [+ Neue Extension]     │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 🛒 E-Commerce Starter    v1.3.0  ✅ Aktiv               │   │
│  │ by Multibase             Installiert: 12. März 2026      │   │
│  │                          [Konfiguration] [Deinstallieren] │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ ⚡ Stripe Webhooks       v2.1.0  ✅ Aktiv               │   │
│  │ by Multibase             Installiert: 10. März 2026      │   │
│  │                          [Konfiguration] [Deinstallieren] │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Keine weiteren Extensions installiert.                          │
│  [Extension Marketplace öffnen →]                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Community Extension SDK (`multibase-extension` CLI)

Für Phase 2: Entwickler können eigene Extensions erstellen und einreichen.

### Installation

```bash
npm install -g @multibase/extension-cli
```

### Workflow

```bash
# 1. Neue Extension scaffolden
multibase-extension create my-awesome-extension
# → Erstellt Ordnerstruktur + multibase.extension.json Template

# 2. Extension validieren
multibase-extension validate
# → Prüft manifest gegen JSON-Schema, testet SQL-Syntax, prüft Pflichtfelder

# 3. Lokal testen (gegen lokale Multibase-Instanz)
multibase-extension test --instance http://localhost:3001 --api-key <key>

# 4. Zur Registry einreichen (öffnet GitHub PR-Flow)
multibase-extension submit
# → Erstellt Pull Request auf https://github.com/multibase/extension-registry
```

### Generierte Ordnerstruktur

```
my-awesome-extension/
├── multibase.extension.json   ← Manifest
├── README.md                  ← Dokumentation (wird auf Marketplace angezeigt)
├── CHANGELOG.md               ← Versionshistorie
├── icon.png                   ← 256×256 Icon
├── screenshots/
│   ├── screenshot1.png
│   └── screenshot2.png
└── migrations/
    ├── 001_schema.sql
    ├── 002_rls.sql
    ├── 003_seed.sql           ← optional
    └── rollback.sql
```

---

## Sicherheits-Konzept

### SQL-Injection-Prävention

- Alle SQL-Dateien werden vor Ausführung durch einen statischen Analyzer geleitet
- Verbotene Statements: `DROP DATABASE`, `DROP ROLE`, `CREATE ROLE`, `ALTER SYSTEM`, `COPY TO/FROM`
- Nur verifizierte Extensions (von Multibase signiert) können `service_role`-Kontext nutzen

### Manifest-Validierung

- JSON-Schema-Validierung aller Manifeste gegen `extension-schema-v1.json`
- SHA256-Checksummen für alle SQL-Dateien (gegen Manifest gespeichert)
- Zertifikat-basierte Signierung für "Verified"-Extensions

### Rate Limiting

- Max. 3 Installationen pro Instanz pro Stunde
- Admin-Override möglich

---

## API-Endpunkte — Zusammenfassung

```
# Marketplace (global)
GET    /api/marketplace/extensions              # Liste aller Extensions
GET    /api/marketplace/extensions/:id          # Extension-Details + Manifest
POST   /api/marketplace/sync                    # Admin: Registry neu laden

# Instanz-spezifisch
GET    /api/instances/:name/extensions          # Installierte Extensions
POST   /api/instances/:name/extensions          # Extension installieren
DELETE /api/instances/:name/extensions/:extId   # Extension deinstallieren
GET    /api/instances/:name/extensions/:extId/status  # Status prüfen
```

---

## Prisma-Migration

```bash
# Nach Hinzufügen der Modelle:
cd dashboard/backend
npx prisma migrate dev --name add_extension_marketplace

# Seed der offiziellen Extensions in die DB:
npx ts-node scripts/seed-marketplace.ts
```

### `seed-marketplace.ts` (Beispiel)

```typescript
const officialExtensions: Prisma.ExtensionCreateInput[] = [
  {
    id: 'ecommerce-starter',
    name: 'E-Commerce Starter',
    description: 'Vollständiges PostgreSQL-Schema für E-Commerce.',
    version: '1.3.0',
    author: 'Multibase',
    category: 'database',
    tags: 'ecommerce,schema,starter,pgvector',
    verified: true,
    featured: true,
    installType: 'sql',
    minVersion: '1.5.0',
    manifestUrl: 'https://cdn.multibase.dev/extensions/ecommerce-starter/manifest.json',
  },
  // ... 19 weitere offizielle Extensions
];

await prisma.extension.createMany({ data: officialExtensions, skipDuplicates: true });
```

---

## Release-Plan

### Phase 1 — v2.0-alpha (Monat 1–2)

- [ ] Prisma-Modelle `Extension` + `InstalledExtension` + Migration
- [ ] `ExtensionService.ts` (SQL-Installer)
- [ ] Backend: `marketplace.ts` + `extensions.ts` Routen
- [ ] `seed-marketplace.ts` mit 5 offiziellen Extensions (ecommerce-starter, stripe-webhooks, social-login-bundle, rag-starter, grafana-dashboard)
- [ ] `MarketplacePage.tsx` (Browse + Filter + Featured)
- [ ] `ExtensionCard.tsx` + `ExtensionDetailModal.tsx`
- [ ] `ExtensionsTab.tsx` im Workspace

### Phase 2 — v2.0-beta (Monat 3–4)

- [ ] `InstallWizard.tsx` mit Schritt-für-Schritt-Flow + Config-Schema
- [ ] 15 weitere offizielle Extensions (volle Bibliothek)
- [ ] Sicherheits-Analyzer für SQL-Dateien
- [ ] SHA256-Prüfung + Manifest-Signierung
- [ ] AuditLog-Einträge für Install/Uninstall

### Phase 3 — v2.0 GA (Monat 5–6)

- [ ] `multibase-extension` Community CLI
- [ ] Extension-Registry GitHub-Repository + PR-basierter Submit-Flow
- [ ] Auto-Update-Checker (Background Worker, wöchentlich)
- [ ] Rating & Review System (1–5 Sterne)
- [ ] Extension Analytics (Installationszähler, populärste Extensions)

---

## Aufwand/Impact-Schätzung

| Phase | Aufwand (Entwicklertage) | Deliverable |
|-------|--------------------------|-------------|
| Phase 1 | ~8 Tage | MVP: 5 Extensions, Browser, Installer |
| Phase 2 | ~10 Tage | 20 Extensions, Wizard, Sicherheit |
| Phase 3 | ~12 Tage | Community SDK, Auto-Updates, Analytics |
| **Gesamt** | **~30 Tage** | **Vollständiger Marketplace** |

---

*Erstellt: März 2026 | Status: In Planning (v2.0)*
