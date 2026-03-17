# Multibase Roadmap — Feature-Vergleich mit Supabase

> Basierend auf einer umfassenden Analyse der Supabase Docs und dem aktuellen Multibase Feature-Stand (v1.0–v1.7).
> Stand: März 2026 | Letzte Aktualisierung: 17. März 2026

---

## Aktueller Status — Was Multibase bereits abdeckt

| Bereich | Status | Version |
|---|---|---|
| Multi-Instance Docker-Orchestrierung | ✅ Vollständig | v1.0 |
| Auth & Session Management (JWT, Bcrypt, 2FA) | ✅ Vollständig | v1.0 / v1.1 |
| Backup & Restore (inkl. S3, Scheduling, PITR) | ✅ Vollständig | v1.1 |
| Monitoring, Alerts, Audit-Logs | ✅ Vollständig | v1.1 |
| Storage Manager (Upload, Signed URLs, Folders) | ✅ Vollständig | v1.2 |
| Instance Cloning & Snapshots | ✅ Vollständig | v1.2 |
| Cloud-Architektur (Shared Services, ~75% RAM-Ersparnis) | ✅ Vollständig | v1.3 |
| Kong → Nginx Gateway Migration | ✅ Vollständig | v1.3 |
| AI Chat Agent (30+ Tools, Multi-Provider) | ✅ Vollständig | v1.3 |
| Workspace Page (Studio, API Keys, SMTP) | ✅ Vollständig | v1.3 |
| Multi-Tenancy / Organisationen / RBAC | ✅ Vollständig | v1.4 |
| One-Click Install + SSL + PM2 | ✅ Vollständig | v1.0+ |
| GraphQL API Playground (pg_graphql) | ✅ Vollständig | v1.5 |
| Database Webhooks (pg_net) | ✅ Vollständig | v1.5 |
| Cron Job Manager (pg_cron) | ✅ Vollständig | v1.5 |
| AI & Vectors — pgvector (Extensions, Columns, Indexes, Search) | ✅ Vollständig | v1.5 |
| Message Queues (pgmq) | ✅ Vollständig | v1.5 |
| Workspace Redesign (3-Level-Nav, Org-Auswahl, Projekt-Grid, Sidebar) | ✅ Vollständig | v1.5 |
| Auth-Tab im Workspace + Auth-Erweiterungen (Phone/CAPTCHA/SAML/Templates) | ✅ Vollständig | **v1.6** |
| Custom Domains pro Tenant (DNS-Check + Certbot) | ✅ Vollständig | **v1.6** |
| Environment-Labels (Production/Staging/Dev) + Clone-Shortcuts | ✅ Fertig | **v1.6** |
| Storage: Tus Resumable Uploads + Nginx CDN Cache | ✅ Fertig | **v1.6** |
| Vault Secrets UI (pgsodium/pg_vault) + Dokumentation | ✅ Fertig | **v1.6** |
| Network Restrictions (IP-Whitelist, SSL-Enforcement, Rate-Limiting) | ✅ Fertig | **v1.6** |
| Edge Functions IDE (CodeMirror, TypeScript, Env Vars, Test-Runner) | ✅ Vollständig | **v1.7** |
| Realtime Dashboard (Config, Live Stats, Active Channels, Quick Connect) | ✅ Vollständig | **v1.7** |
| Log Drains (Webhook-Export, json/ndjson/logfmt, 30s Polling, Test-Delivery) | ✅ Vollständig | **v1.7** |
| Read Replicas (Externe PostgreSQL-Registrierung, Status-Monitor, Lag-Anzeige) | ✅ Vollständig | **v1.7** |
| MCP Server (12 Tools, JSON-RPC 2.0, Claude Desktop / Cursor / VS Code) | ✅ Vollständig | **v1.7** |

---

## Fehlende Features — Supabase vs. Multibase Gap-Analyse

### Priorität 1 — Hoher Mehrwert, direkt umsetzbar

#### 1. GraphQL API (pg_graphql)
**Supabase:** Auto-generierte GraphQL API über die `pg_graphql`-Extension. Vollständige CRUD-Operationen, Filtering, Pagination, Relationships — alles automatisch aus dem DB-Schema abgeleitet.

**Multibase:** ⚠️ **Teilweise vorhanden** — Das `graphql_public`-Schema ist in `ApiTab.tsx` bereits als exponiertes Schema gelistet (`PGRST_DB_SCHEMAS`), aber es gibt keine dedizierte GraphQL-Verwaltungs-UI.

**Vorschlag:**
- Dedizierte GraphQL-Sektion in der Dashboard-UI (Endpoint anzeigen, testen)
- GraphQL Playground / Explorer einbinden
- Routing im Nginx Gateway explizit pro Tenant konfigurierbar machen

**Aufwand:** Niedrig | **Impact:** Hoch

---

#### 2. Database Webhooks (pg_net)
**Supabase:** Bei `INSERT`, `UPDATE`, `DELETE` Events werden automatisch HTTP-Webhooks (POST/GET) an externe Services gesendet. Async über `pg_net`-Extension.

**Multibase:** Kein Webhook-Management vorhanden.

**Vorschlag:**
- Dashboard-UI zum Erstellen/Verwalten von Database Webhooks pro Tenant
- Extension existiert bereits in der Supabase-Postgres-Fork
- UI + API-Endpoints für CRUD von Webhook-Triggern

**Aufwand:** Niedrig | **Impact:** Hoch

---

#### 3. Cron Jobs (pg_cron)
**Supabase:** Integriertes Cron-System zum Planen wiederkehrender SQL-Jobs direkt in Postgres. Jeder Job kann SQL-Snippets oder HTTP-Requests ausführen (von jede Sekunde bis einmal jährlich).

**Multibase:** ⚠️ **Nur für Backups vorhanden** — Cron-Scheduling existiert in `BackupManagement.tsx` mit Cron-Expressions für automatisierte Backups (`SchedulerService.ts`). Kein allgemeines `pg_cron`-UI für eigene Datenbank-Jobs.

**Vorschlag:**
- Allgemeiner Cron-Job-Manager im Dashboard (Create, Edit, Monitor, Delete)
- `pg_cron`-Extension ist bereits in Supabase-Postgres vorhanden
- Job-Run-History mit Status-Tracking aus `cron.job_run_details`

**Aufwand:** Mittel | **Impact:** Hoch

---

#### 4. Message Queues (pgmq)
**Supabase:** Durable Message Queues mit guaranteed delivery, exactly-once delivery und message archival über `pgmq`-Extension.

**Multibase:** Kein Queue-System vorhanden.

**Vorschlag:**
- Queue-Manager-UI im Dashboard
- Queues erstellen, Messages einsehen, Consumer-Monitoring
- Besonders nützlich für Background-Jobs und Event-Driven Architectures

**Aufwand:** Mittel | **Impact:** Mittel

---

#### 5. Row Level Security (RLS) Manager
**Supabase:** Visueller RLS-Policy-Editor im Studio — Policies per Klick erstellen und testen.

**Multibase:** ✅ **Bereits vollständig implementiert** — `PoliciesTab.tsx` + `CreatePolicyModal.tsx` bieten komplettes RLS-Management: Enable/Disable per Tabelle, Policy-CRUD mit SELECT/INSERT/UPDATE/DELETE, Rollen (anon, authenticated, service_role), USING & WITH CHECK Expressions.

**Status:** ✅ Fertig — kein Handlungsbedarf

---

### Priorität 2 — Strategisch wichtig

#### 6. AI & Vectors (pgvector)
**Supabase:** Starke Positionierung als AI/Vector-Datenbank:
- Vector-Spalten mit `pgvector`-Extension
- Automatic Embeddings
- Semantic Search, Keyword Search, Hybrid Search
- RAG mit Permissions
- Integrationen: OpenAI, Hugging Face, LangChain, LlamaIndex, Amazon Bedrock

**Multibase:** ⚠️ **AI Chat vorhanden, pgvector fehlt** — AI Chat Agent mit Multi-Provider-Support (OpenAI, Anthropic, Gemini, OpenRouter) ist fertig (`AiChatPanel.tsx`, `AiAgentService.ts`). Der „Vector"-Container ist Vector.dev (Log-Aggregator), **nicht** pgvector für Embeddings.

**Vorschlag:**
- Vector-Dashboard-Modul: Collections anzeigen, Embeddings verwalten, Similarity-Search testen
- Automatische `pgvector`-Extension-Aktivierung pro Tenant bei Instanz-Erstellung
- Template: "AI-Ready Instance" mit vorkonfiguriertem pgvector + Beispiel-Schema
- Integration in den bestehenden AI Chat Agent (Vektor-Abfragen über Tool)

**Aufwand:** Mittel | **Impact:** Sehr hoch (Differenzierung)

---

#### 7. Auth-Konfigurations-UI (Social Login, Phone, Magic Links, SAML SSO, CAPTCHA)
**Supabase Auth (GoTrue) unterstützt:**
- Social Login: Apple, Google, GitHub, Slack, Discord, Twitter, etc. (30+ Provider)
- Phone Login: SMS-basiert via Twilio/MessageBird
- Magic Links: Passwortlose E-Mail-Authentifizierung
- SAML SSO: Enterprise Single Sign-On
- CAPTCHA: hCaptcha/Turnstile-Schutz
- Auth Hooks: Custom-Logic bei Auth-Events
- Third-Party Auth: Eigene JWT-Issuer einbinden

**Multibase:** ✅ **Social Login bereits implementiert** — `AuthTab.tsx` erlaubt Konfiguration von Google, GitHub, Discord, Facebook, Twitter, GitLab, Bitbucket, Apple via Environment Variables mit automatischem Service-Neustart.

**Noch offen (v1.6):**
- Phone Login (SMS via Twilio/MessageBird)
- Magic Link E-Mail-Templates anpassen
- SAML SSO (Enterprise Feature)
- CAPTCHA Integration (hCaptcha/Turnstile)
- Auth Hooks / Third-Party JWT

**Aufwand:** Mittel | **Impact:** Mittel (Basis done, Erweiterungen offen)

---

#### 8. Custom Domains / White-Labeling
**Supabase:** Custom Domains pro Projekt — APIs laufen unter eigener Domain (z.B. `api.meinefirma.de`).

**Multibase:** Nicht vorhanden.

**Vorschlag:**
- Custom-Domain-Verwaltung pro Tenant im Dashboard
- DNS-Validierung (CNAME/TXT Record Check)
- Automatische SSL-Zertifikat-Generierung (Let's Encrypt)
- Nginx-Gateway-Konfiguration auto-update
- Ideal für Agenturen, die Kunden eigene Domains geben wollen

**Aufwand:** Mittel | **Impact:** Hoch

---

#### 9. Branching / Environments (Dev/Staging/Prod)
**Supabase:** Database Branching — separate Datenbank-Branches für Entwicklung/Testing, automatisch bei Git-Branches erstellt.

**Multibase:** Instance Cloning vorhanden, aber kein Environment-Konzept.

**Vorschlag:**
- Environment-Management pro Organisation
- "Clone to Staging" Button (nutzt vorhandenes Cloning-Feature)
- Branch-Tracking mit Git-Integration
- Diff-View zwischen Branch- und Produktions-Schema
- One-Click Promote to Production

**Aufwand:** Hoch | **Impact:** Mittel

---

#### 10. Database Replication & Read Replicas
**Supabase:** Read Replicas in verschiedenen Regionen + Replication zu externen Data-Warehouses.

**Multibase:** Nicht vorhanden.

**Vorschlag:**
- Replication-Setup-Wizard pro Tenant
- Read-Replica-Management im Dashboard (Cloud-Deployments)
- Log-basierte Replikation zu Analytics-Systemen

**Aufwand:** Hoch | **Impact:** Mittel

---

### Priorität 3 — Nice-to-Have / Langfristig

#### 11. Supabase Vault (Secrets & Encryption)
Verschlüsselung sensibler Daten und Secrets-Management direkt in Postgres.

**Vorschlag:** Vault-UI im Dashboard — Secrets speichern, verschlüsselte Spalten verwalten.

**Aufwand:** Niedrig | **Impact:** Mittel

---

#### 12. SQL Editor im Dashboard
Supabase Studio hat einen interaktiven SQL-Editor mit Syntax-Highlighting, Auto-Complete und gespeicherten Queries.

**Multibase:** ✅ **Bereits implementiert** — Ein „Quick SQL Editor" ist in `SupabaseManager.tsx` eingebettet. Backend-Endpoint `POST /api/instances/:name/sql` ist funktionsfähig.

**Offen (Verbesserung, niedrige Prio):**
- Syntax-Highlighting (Monaco Editor)
- Gespeicherte Queries pro Organisation
- Query-History und Performance-Analyse

**Aufwand:** Niedrig (Erweiterung) | **Impact:** Mittel

---

#### 13. Edge Functions Management UI
Multibase deployed Edge Functions pro Tenant, aber keine UI zum Erstellen/Bearbeiten/Deployen.

**Vorschlag:**
- Code-Editor (Monaco) im Dashboard
- Deploy-Button mit Live-Logs
- Environment Variables Management pro Function
- Function-Metriken (Invocations, Errors, Latency)

**Aufwand:** Hoch | **Impact:** Mittel

---

#### 14. Log Drains
Supabase erlaubt Export von Logs an externe Provider (Datadog, Grafana Loki, etc.).

**Vorschlag:**
- Log-Drain-Konfiguration pro Organisation
- Ziele: Datadog, Grafana Loki, Elasticsearch, Webhook
- Filter pro Service (Auth, REST, DB, Realtime)

**Aufwand:** Mittel | **Impact:** Niedrig

---

#### 15. Realtime Broadcast & Presence Dashboard
Supabase Realtime bietet neben DB-Changes auch Broadcast (Messages zwischen Usern) und Presence (Online-Status, Typing-Indicators).

**Vorschlag:**
- Realtime-Dashboard pro Tenant: Active Channels, Connected Clients
- Broadcast-Test-Tool
- Presence-Visualisierung

**Aufwand:** Mittel | **Impact:** Niedrig

---

#### 16. Storage CDN & Resumable Uploads
Supabase Storage bietet CDN, Smart CDN, Resumable Uploads (Tus-Protokoll) und S3-Kompatibilität.

**Vorschlag:**
- CDN-Layer (Cloudflare/Nginx Cache) für Storage-Assets
- Resumable Upload Support im Storage Manager
- S3-kompatible API exponieren pro Tenant
- Storage-Metriken (Bandwidth, Requests, Cache Hit Rate)

**Aufwand:** Mittel | **Impact:** Mittel

---

#### 17. Network Restrictions & SSL Enforcement
**Vorschlag:** Security-Panel pro Tenant:
- IP-Whitelisting für Datenbank-Zugriff
- SSL-Only Enforcement
- Connection-Limits
- Rate-Limiting pro Tenant

**Aufwand:** Niedrig | **Impact:** Mittel

---

#### 18. Terraform Provider / Infrastructure as Code
**Vorschlag:**
- Terraform-Provider oder Pulumi-Plugin für Multibase
- Deklarative Instanz-Konfiguration via YAML
- GitOps-Workflow: Instanzen über Git-Repository verwalten

**Aufwand:** Hoch | **Impact:** Mittel

---

#### 19. MCP Server (Model Context Protocol)
Supabase bietet einen MCP Server für AI-Agents (Claude, ChatGPT, etc.).

**Vorschlag:** Multibase MCP Server zum Verwalten von Instanzen, DB-Queries, Backups und Storage über AI-Agents. Baut auf dem vorhandenen AI Chat Agent auf.

**Aufwand:** Mittel | **Impact:** Mittel

---

#### 20. Management SDK / Client Libraries
Supabase bietet offizielle SDKs für JavaScript, Flutter, Python, C#, Swift, Kotlin.

**Vorschlag:**
- Multibase Management SDK (TypeScript + Python)
- Programmatischer Zugriff auf die Management API
- Instanz-Lifecycle, Backup-Automation, Metriken-Abfrage

**Aufwand:** Mittel | **Impact:** Niedrig

---

## Aufwand/Impact-Matrix

| # | Feature | Impact | Aufwand | Version |
|---|---------|--------|---------|---------|
| 1 | GraphQL API Playground (pg_graphql) | ✅ Fertig | — | ~~v1.5~~ |
| 2 | Database Webhooks (pg_net) | ✅ Fertig | — | ~~v1.5~~ |
| 3 | Cron Job Manager (pg_cron) | ✅ Fertig | — | ~~v1.5~~ |
| 4 | Message Queues (pgmq) | ✅ Fertig | — | ~~v1.5~~ |
| 5 | RLS Policy Editor | ✅ Fertig | — | ~~v1.5~~ |
| 6 | AI & Vectors (pgvector) | ✅ Fertig | — | ~~v1.5~~ |
| 7 | Auth: Phone/SSO/CAPTCHA | ✅ Fertig | — | ~~v1.6~~ |
| 7a | Auth: Social Login | ✅ Fertig | — | ~~v1.6~~ |
| 8 | Custom Domains | ✅ Fertig | — | ~~v1.6~~ |
| 9 | Environment-Labels + Clone-Shortcuts | ✅ Fertig | 🟢 Niedrig | **v1.6** |
| 10 | Read Replicas | ✅ Fertig | — | ~~v1.7~~ |
| 11 | Vault (Secrets) | ✅ Fertig | — | ~~v1.6~~ |
| 12 | SQL Editor (Basis) | ✅ Fertig | — | ~~v1.5~~ |
| 12a | SQL Editor (Monaco/History) | 🟠 Niedrig | 🟢 Niedrig | **v1.6** |
| 13 | Edge Functions IDE | ✅ Fertig | — | ~~v1.7~~ |
| 14 | Log Drains | ✅ Fertig | — | ~~v1.7~~ |
| 15 | Realtime Dashboard | ✅ Fertig | — | ~~v1.7~~ |
| 16 | Storage CDN/Resumable | ✅ Fertig | 🟡 Mittel | **v1.6** |
| 17 | Network Restrictions | ✅ Fertig | — | ~~v1.6~~ |
| 18 | Terraform/IaC | 🟡 Mittel | 🔴 Hoch | **v2.0** |
| 19 | MCP Server | ✅ Fertig | — | ~~v1.7~~ |
| 20 | Management SDK | 🟠 Niedrig | 🟡 Mittel | **v2.0** |

---

## Release-Plan

### v1.5 — Quick Wins + Differenzierung ✅ Abgeschlossen
> Fokus: Postgres-Extensions freischalten + Developer Experience

- [x] ~~SQL Editor im Dashboard~~ ✅ Quick SQL Editor in `SupabaseManager.tsx` vorhanden
- [x] ~~RLS Policy Editor~~ ✅ Vollständig implementiert (`PoliciesTab` + `CreatePolicyModal`)
- [x] ~~Social Auth Config~~ ✅ Google, GitHub, Discord etc. in `AuthTab.tsx` konfigurierbar
- [x] GraphQL API Playground + Routing pro Tenant (`ApiTab.tsx` — Status, Endpoint, Copy-Button)
- [x] Database Webhooks UI (`WebhooksTab`, `CreateWebhookModal`, `WebhookService`, `pg_net`)
- [x] Cron Job Manager (`CronJobsTab`, `CreateCronJobModal`, `CronService`, `pg_cron`)
- [x] AI & Vectors (`VectorsTab`, `CreateVectorColumnModal`, `VectorService`, `pgvector`)
- [x] Message Queues (`QueuesTab`, `CreateQueueModal`, `QueueService`, `pgmq`)
- [x] Workspace Redesign — 3-Level-Navigation:
  - `/workspace` → Org-Karten-Grid (`WorkspaceOrgsPage`)
  - `/workspace/projects` → Projekt-Card-Grid mit OrgSwitcher (`WorkspaceProjectsPage`)
  - `/workspace/projects/:project/:tab` → Fixed Sidebar mit allen Manager-Tabs (`WorkspaceProjectPage`)

### v1.6 — Enterprise & Agenturen
> Fokus: White-Labeling, Security, Auth-Erweiterungen
> Detailplan: [V1.6_IMPLEMENTATION_PLAN.md](V1.6_IMPLEMENTATION_PLAN.md)

- [x] Auth-Tab in Workspace Sidebar einbinden + aus InstanceDetail entfernen
- [x] Auth-Erweiterungen: Phone Login (Twilio/MessageBird/Vonage Konfig), CAPTCHA (hCaptcha/Turnstile), Magic Link HTML-Template-Bodies, SAML SSO
- [x] Custom Domains pro Tenant (DNS-CNAME-Check + Certbot SSL + Nginx-Konfig)
- [x] Environment-Labels (production/staging/dev/preview) + "Clone as Staging/Dev" Shortcuts
- [x] Storage: Tus Resumable Uploads (>6 MB) + Nginx CDN Cache-Header für public Buckets
- [x] Vault Secrets UI — CRUD auf `vault.secrets` (pgsodium) + Dokumentationsseite
- [x] Network Restrictions: IP-Whitelist, SSL-Only Enforcement, Rate-Limiting pro Instanz

### v1.7 — Scale & Ecosystem
> Fokus: Skalierung, Observability, Ecosystem  
> Detailplan: [V1.7_IMPLEMENTATION_PLAN.md](V1.7_IMPLEMENTATION_PLAN.md)

- [x] Edge Functions IDE (CodeMirror + TypeScript + Env Vars + Test-Runner) ✅
- [x] Read Replicas (PostgreSQL Streaming Replication UI) ✅
- [x] Log Drains (Webhook-basierter Log-Export) ✅
- [x] Realtime Dashboard (Channels, Presence, Concurrent Users Config) ✅
- [x] MCP Server (Model Context Protocol — AI-Assistenten-Integration) ✅

### v2.0 — Platform Maturity
> Fokus: IaC, SDK, Marketplace, Multi-Region  
> Detailplan: [Readme2_0_Feature.md](Readme2_0_Feature.md)

- [ ] **Terraform Provider** — Deklarative Instanz-Konfiguration via HCL (`terraform-plugin-framework`, Terraform Registry Publish)
- [ ] **Management SDK TypeScript** — `@multibase/sdk` auf npm, versionierte `/api/management/v1/` Endpunkte, OpenAPI 3.1 Spec
- [ ] **Management SDK Python** — `multibase-sdk` auf PyPI, Async-Support, gleiche Module wie TS SDK
- [ ] **Extension Marketplace** — `/settings/marketplace` + `ExtensionsTab` im Workspace, 20 offizielle Extensions, Community-SDK | [→ Detailplan](EXTENSION_MARKETPLACE_PLAN.md)
- [ ] **Multi-Region Deployment** — `Region` Prisma-Model, Control-Plane/Agent-Architektur, Geo-Routing, Failover

---

## CLI — Status

> **Die CLI ist bereits implementiert** — `supabase_manager.py` ist ein **eigener Python 3 CLI** (~519 Zeilen), der speziell für dieses Projekt entwickelt wurde.  
> Er ist **kein Bestandteil des Supabase-Stacks** (Supabase enthält keine vergleichbare Management-CLI für Multi-Tenant-Deployments).

### Verfügbare Befehle

```bash
python supabase_manager.py shared-start              # Shared Infrastructure starten
python supabase_manager.py shared-stop               # Shared Infrastructure stoppen
python supabase_manager.py shared-status             # Status anzeigen
python supabase_manager.py create <name> --base-port <port>  # Tenant erstellen
python supabase_manager.py start <name>              # Tenant starten
python supabase_manager.py stop <name>               # Tenant stoppen
python supabase_manager.py reset <name>              # Tenant zurücksetzen
python supabase_manager.py status <name>             # Status prüfen
python supabase_manager.py list                      # Alle Tenants auflisten
```

In v2.0 wird die CLI um SDK-Wrapper-Befehle erweitert.

---

*Erstellt: März 2026 | Letzte Aktualisierung: 17. März 2026*
