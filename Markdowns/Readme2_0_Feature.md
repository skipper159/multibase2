# Multibase v2.0 — Feature Plan

**Status:** 🚧 In Planning  
**Planned Release:** Q3 2026  
**Fokus:** Infrastructure-as-Code, programmatischer Zugriff, Erweiterbarkeit, globale Skalierung

---

## CLI — Statusklärung

> **Die CLI ist bereits implementiert** — `supabase_manager.py` ist ein **eigener Python 3 CLI** (ca. 519 Zeilen), der speziell für dieses Projekt entwickelt wurde.  
> Er ist **kein Bestandteil des Supabase-Stacks**.

### Verfügbare Befehle

```bash
# Shared Infrastructure
python supabase_manager.py shared-start              # 8 Shared-Services starten
python supabase_manager.py shared-stop               # Shared-Services stoppen
python supabase_manager.py shared-status             # Status anzeigen

# Tenant Management
python supabase_manager.py create <name> --base-port <port>  # Tenant erstellen
python supabase_manager.py start <name> [--verbose]          # Tenant starten
python supabase_manager.py stop <name> [--keep-volumes]      # Tenant stoppen
python supabase_manager.py reset <name>                      # Tenant zurücksetzen
python supabase_manager.py status <name>                     # Status prüfen
python supabase_manager.py list                              # Alle Tenants auflisten
```

### Zugehörige Dateien

| Datei | Zweck | Zeilen |
|-------|-------|--------|
| `supabase_manager.py` | Haupt-CLI, Entry Point | ~519 |
| `supabase_setup.py` | Per-Tenant Docker-Compose-Generator mit JWT/Credentials | ~27.300 |
| `setup_shared.py` | Shared-Infrastructure-Bootstrap | ~23.900 |

Die CLI wird in v2.0 um SDK-Wrapper-Befehle erweitert, um eine reichhaltigere Developer-Experience zu bieten.

---

## Offene Features — v2.0 Release Plan

Alle Features bis einschließlich v1.7 sind vollständig implementiert (✅). Folgende Features sind noch offen:

### 1. Terraform Provider / Infrastructure as Code

**Status:** ⬜ Nicht begonnen  
**Aufwand:** Hoch | **Impact:** Hoch

**Was es ist:**  
Ein Terraform-Provider ermöglicht es, Multibase-Instanzen, Organisationen, API-Keys und Konfigurationen deklarativ in HCL zu verwalten — genau wie der offizielle Supabase-Terraform-Provider.

**Beispiel:**

```hcl
resource "multibase_instance" "production" {
  name  = "my-app-prod"
  label = "production"
}

resource "multibase_api_key" "ci_key" {
  name        = "ci-deploy"
  instance_id = multibase_instance.production.id
  permissions = ["read", "backup"]
}
```

**Implementierungsschritte:**
1. Provider-Scaffold mit `terraform-plugin-framework` (Go)
2. CRUD für `multibase_instance` und `multibase_api_key`
3. Alle Ressourcen: Domains, Backups, Network Restrictions, Vault Secrets
4. Import-Support (`terraform import`)
5. Veröffentlichung auf dem Terraform Registry

---

### 2. Management SDK (TypeScript + Python)

**Status:** ⬜ Nicht begonnen  
**Aufwand:** Mittel | **Impact:** Hoch

**Was es ist:**  
Offizielle SDKs für programmatischen Zugriff auf die Multibase Management API. Ermöglicht Automatisierung, CI/CD-Pipelines und Third-Party-Integrationen ohne Shell-Scripting.

**TypeScript-Beispiel:**

```typescript
import { MultibaseClient } from '@multibase/sdk';

const client = new MultibaseClient({
  url: 'https://your-multibase-host',
  apiKey: process.env.MULTIBASE_API_KEY,
});

const instances = await client.instances.list();
await client.instances.start('my-app');
const metrics  = await client.metrics.get('my-app');
```

**Python-Beispiel:**

```python
from multibase import MultibaseClient

client = MultibaseClient(url="...", api_key=os.environ["MULTIBASE_API_KEY"])
instances = client.instances.list()
client.instances.start("my-app")
```

**SDK-Module:** `instances`, `backups`, `storage`, `metrics`, `logs`, `sql`, `apiKeys`, `organisations`, `functions`

**Implementierungsschritte:**
1. Versionierte `/api/management/v1/` Endpunkte im Backend
2. OpenAPI 3.1 Spec aus bestehenden Routen generieren
3. TypeScript SDK → npm Paket `@multibase/sdk`
4. Python SDK → PyPI Paket `multibase-sdk`
5. SDK-Referenzdokumentation

---

### 3. Extension Marketplace

**Status:** ⬜ Nicht begonnen  
**Aufwand:** Mittel | **Impact:** Mittel

**Was es ist:**  
Ein kuratierter Marktplatz, über den Nutzer vorgefertigte Erweiterungen — Datenbank-Templates, Edge-Function-Starter, Auth-Konfigurationen, Monitoring-Integrationen — per One-Click installieren können.

**Extension-Kategorien:**

| Kategorie | Beispiele |
|-----------|-----------|
| Datenbank-Templates | E-Commerce-Schema, Blog, SaaS-Starter, Multi-Tenant |
| Auth-Configs | Social-Login-Presets, Enterprise SSO, CAPTCHA |
| Edge Functions | Stripe-Webhooks, Resend-Email, Slack, PDF-Generator |
| Monitoring | Grafana-Dashboard, Datadog, Sentry |
| AI/Vectors | pgvector-Starter, Embedding-Pipeline, RAG-Template |

**Neues Prisma-Model:**

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

**Implementierungsschritte:**
1. `InstalledExtension` Prisma-Model + Migration
2. Backend: Install/Uninstall-Endpoints
3. Frontend: `/settings/marketplace` Browser + Install-Wizard
4. 5 offizielle Extensions als Startpaket
5. Community-Extension-SDK in Phase 2

---

### 4. Multi-Region Deployment

**Status:** ⬜ Nicht begonnen  
**Aufwand:** Hoch | **Impact:** Mittel

**Was es ist:**  
Multibase-Instanzen in verschiedenen geografischen Regionen deployen, um die Latenz für globale Nutzer zu reduzieren. Unterstützt Primary/Replica-Topologie mit automatischem Failover. Baut auf dem v1.7 Read-Replicas-Feature auf.

**Neues Prisma-Model:**

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

**Initiale Regionen:** `eu-west-1` (Frankfurt), `us-east-1` (New York), `ap-southeast-1` (Singapore), `custom` (Eigener VPS)

**Implementierungsschritte:**
1. `regionId` zu `Instance`-Model hinzufügen
2. Region-Management-UI in Admin-Einstellungen
3. Region-Badge auf Instance-Cards
4. Multi-Node: Control-Plane → Agent-Architektur
5. Geo-Routing + automatisches Failover

---

## Release-Timeline

| Milestone | Zeitraum | Fokus |
|-----------|----------|-------|
| v2.0-alpha | Monat 1–2 | Management SDK TypeScript + OpenAPI Spec |
| v2.0-beta | Monat 3–4 | Python SDK + Extension Marketplace (static) + Terraform Provider (basics) |
| v2.0 GA | Monat 5–6 | Terraform Registry + npm/PyPI publish + Multi-Region PoC |

---

## Aufwand/Impact-Matrix

| # | Feature | Impact | Aufwand | Priorität |
|---|---------|--------|---------|-----------|
| 1 | Terraform Provider | 🔴 Hoch | 🔴 Hoch | High |
| 2 | Management SDK (TS + Python) | 🔴 Hoch | 🟡 Mittel | High |
| 3 | Extension Marketplace | 🟡 Mittel | 🟡 Mittel | Medium |
| 4 | Multi-Region Deployment | 🟡 Mittel | 🔴 Hoch | Medium |

---

*Erstellt: März 2026*
