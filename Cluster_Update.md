# Cluster Update – Backend High-Availability

> **Ziel:** Das Multibase-Dashboard-Backend redundant auf mehreren Servern betreiben,
> sodass bei Ausfall eines Nodes der andere übernimmt. Möglichst einfach gehalten.

---

## 1. Idee / Überblick

Aktuell läuft ein einzelner Express-Backend-Prozess (PM2, Port 3001) auf einem Server.
Fällt dieser aus, ist das gesamte Dashboard nicht erreichbar.

**Zielarchitektur – Primary / Replica:**

```
                  ┌─────────────────┐
                  │   Nginx / LB    │  ← öffentlicher Endpunkt
                  │  (Health-Check) │
                  └──────┬──────────┘
                         │
            ┌────────────┴────────────┐
            ▼                         ▼
   ┌─────────────────┐     ┌─────────────────┐
   │   Node A (Primary)│     │  Node B (Replica) │
   │  Backend :3001   │     │  Backend :3001   │
   │  SQLite (RW)     │     │  SQLite (RO→RW)  │
   │  PM2             │     │  PM2             │
   │  Docker-Projekte │     │  Docker-Projekte │
   └────────┬─────────┘     └────────┬─────────┘
            │                         │
            └──────────┬──────────────┘
                       ▼
              ┌─────────────────┐
              │   Redis (Shared) │  ← Sessions, Pub/Sub, Socket.IO
              └─────────────────┘
```

**Kernprinzip – Keep It Simple:**
- **Primary** bearbeitet alle Schreibvorgänge (SQLite RW)
- **Replica(s)** lesen von einer synchronisierten SQLite-Kopie
- Bei Ausfall des Primary wird eine Replica automatisch zum neuen Primary
- Beide Nodes teilen sich Redis für Sessions und WebSocket-Events
- Nginx verteilt Traffic und erkennt ausgefallene Nodes

---

## 2. Komponenten-Analyse – Was muss angepasst werden?

### 2.1 Datenbank (SQLite → Litestream-Sync)

| Thema | Aktuell | Cluster |
|-------|---------|---------|
| DB-Engine | SQLite (Datei) | SQLite + **Litestream** |
| Schreibzugriff | Single Node | Primary-Only |
| Replikation | keine | WAL-Streaming zu S3/MinIO, Replicas restoren |
| Failover | manuell | Replica promoted sich, wird RW |

**Litestream** streamt SQLite-WAL-Änderungen in Echtzeit auf einen S3-kompatiblen
Speicher (AWS S3, MinIO, Hetzner Object Storage). Replicas ziehen kontinuierlich
Updates und halten eine lesbare Kopie vor.

**Warum Litestream statt PostgreSQL-Migration?**
- Kein Schema-Umbau nötig → Prisma + SQLite bleibt
- Kein zusätzlicher Datenbankserver
- Litestream ist ein einzelnes Binary (~15 MB), keine Dependencies
- Latenz < 1 Sekunde für Replikation

### 2.2 Sessions & State (Redis)

| Thema | Aktuell | Cluster |
|-------|---------|---------|
| Redis | Lokal (Docker-Container) | **Gemeinsamer Redis** (eigener Server oder Managed) |
| Sessions | Redis-backed | Gleich – alle Nodes nutzen denselben Redis |
| Caching | ioredis | Gleich |

**Umsetzung:** Alle Nodes verbinden sich per `REDIS_URL` zu derselben Redis-Instanz.
Sessions sind damit automatisch auf allen Nodes gültig.

### 2.3 WebSocket / Socket.IO

| Thema | Aktuell | Cluster |
|-------|---------|---------|
| Transport | Socket.IO direkt | Socket.IO + **Redis-Adapter** |
| Sticky Sessions | nicht nötig | **Ja** (Nginx `ip_hash` oder Cookie) |

**Umsetzung:**
```bash
npm install @socket.io/redis-adapter
```

```typescript
// server.ts – Ergänzung
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";

const pubClient = createClient({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();
await Promise.all([pubClient.connect(), subClient.connect()]);

io.adapter(createAdapter(pubClient, subClient));
```

Damit werden Socket.IO-Events (Health-Updates, Alerts, Logs) über Redis
an alle verbundenen Nodes verteilt.

### 2.4 Docker-Management

| Thema | Aktuell | Cluster |
|-------|---------|---------|
| dockerode | Verbindet sich lokal zum Docker-Socket | Lokal pro Node |
| Projekte | Alle auf einem Server | Verteilt oder gespiegelt |

**Zwei Optionen (einfachste zuerst):**

**Option A – Shared-Nothing (empfohlen):**
Jeder Node verwaltet seine eigenen Docker-Projekte. Das Backend kennt nur
seine lokalen Container. Das Dashboard aggregiert über die Cluster-API.

**Option B – Docker über TCP:**
Nodes verbinden sich per TLS zum Docker-Daemon des jeweils anderen Servers.
Komplexer, erfordert Docker-TLS-Zertifikate.

→ **Empfehlung: Option A** – jeder Node ist für seine Projekte verantwortlich.

### 2.5 Nginx / Load Balancer

Nginx auf einem separaten Entry-Point (kann auch auf Node A laufen):

```nginx
upstream multibase_backend {
    ip_hash;                           # Sticky Sessions für Socket.IO

    server node-a.example.com:3001 max_fails=3 fail_timeout=15s;
    server node-b.example.com:3001 max_fails=3 fail_timeout=15s backup;
}

server {
    listen 443 ssl;
    server_name backend.example.com;

    # SSL-Zertifikate
    ssl_certificate     /etc/letsencrypt/live/backend.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/backend.example.com/privkey.pem;

    location / {
        proxy_pass http://multibase_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket-Support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
    }

    # Health-Check Endpunkt
    location /api/health/cluster {
        proxy_pass http://multibase_backend;
        proxy_connect_timeout 3s;
        proxy_read_timeout 3s;
    }
}
```

### 2.6 PM2 Konfiguration

Pro Node bleibt PM2 wie gehabt, mit einer Ergänzung für die Node-Identität:

```javascript
// ecosystem.config.js – Ergänzung
module.exports = {
  apps: [{
    name: "multibase-backend",
    script: "dist/server.js",
    instances: 1,  // NICHT cluster-mode, da SQLite single-writer
    env: {
      NODE_ROLE: "primary",        // oder "replica"
      NODE_ID: "node-a",           // eindeutige ID
      REDIS_URL: "redis://redis.internal:6379",
      LITESTREAM_REPLICA_URL: "s3://multibase-backup/db",
    }
  }]
};
```

---

## 3. Umsetzungsplan – Schritt für Schritt

### Phase 1: Vorbereitung (ohne Downtime)

#### Schritt 1.1 – Cluster Health-Endpunkt erstellen

Neuer API-Endpunkt `/api/health/cluster` der den Node-Status zurückgibt:

```typescript
// src/routes/cluster.ts
import { Router } from "express";
import os from "os";

const router = Router();

router.get("/health", (req, res) => {
  res.json({
    nodeId: process.env.NODE_ID || os.hostname(),
    role: process.env.NODE_ROLE || "standalone",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    healthy: true,
  });
});

router.get("/nodes", async (req, res) => {
  // Alle bekannten Nodes aus Redis abrufen
  const redis = req.app.get("redis");
  const nodes = await redis.hgetall("cluster:nodes");
  res.json(Object.values(nodes).map(n => JSON.parse(n)));
});

export default router;
```

#### Schritt 1.2 – Node-Heartbeat über Redis

Jeder Node registriert sich periodisch in Redis:

```typescript
// src/services/ClusterService.ts
import { Redis } from "ioredis";

export class ClusterService {
  private redis: Redis;
  private nodeId: string;
  private role: "primary" | "replica";
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(redis: Redis) {
    this.redis = redis;
    this.nodeId = process.env.NODE_ID || require("os").hostname();
    this.role = (process.env.NODE_ROLE as any) || "standalone";
  }

  async start() {
    // Heartbeat alle 5 Sekunden
    this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), 5000);
    await this.sendHeartbeat();

    // Überwache andere Nodes
    this.monitorNodes();
  }

  private async sendHeartbeat() {
    const info = JSON.stringify({
      nodeId: this.nodeId,
      role: this.role,
      timestamp: Date.now(),
      uptime: process.uptime(),
    });
    await this.redis.hset("cluster:nodes", this.nodeId, info);
    await this.redis.expire("cluster:nodes", 30); // TTL 30s
  }

  private async monitorNodes() {
    setInterval(async () => {
      const nodes = await this.redis.hgetall("cluster:nodes");
      const now = Date.now();

      for (const [id, data] of Object.entries(nodes)) {
        const node = JSON.parse(data);
        if (now - node.timestamp > 15000) {
          // Node ist seit 15s nicht mehr erreichbar
          console.warn(`[Cluster] Node ${id} nicht erreichbar`);
          await this.redis.hdel("cluster:nodes", id);

          // Wenn Primary ausgefallen → Self-Promote
          if (node.role === "primary" && this.role === "replica") {
            await this.promoteToPrimary();
          }
        }
      }
    }, 5000);
  }

  private async promoteToPrimary() {
    // Distributed Lock um Race-Conditions zu vermeiden
    const lockKey = "cluster:primary-lock";
    const acquired = await this.redis.set(lockKey, this.nodeId, "EX", 30, "NX");

    if (acquired) {
      console.log(`[Cluster] Node ${this.nodeId} wird Primary`);
      this.role = "primary";
      // Litestream: Restore → dann als RW starten
      // Signal an PM2 oder Prozess-Neustart mit NODE_ROLE=primary
    }
  }

  async stop() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    await this.redis.hdel("cluster:nodes", this.nodeId);
  }
}
```

#### Schritt 1.3 – Socket.IO Redis-Adapter einbauen

```bash
cd dashboard/backend
npm install @socket.io/redis-adapter redis
```

In `server.ts` den Adapter aktivieren:

```typescript
import { createAdapter } from "@socket.io/redis-adapter";

// Nach io-Initialisierung:
if (process.env.REDIS_URL) {
  const { createClient } = await import("redis");
  const pub = createClient({ url: process.env.REDIS_URL });
  const sub = pub.duplicate();
  await Promise.all([pub.connect(), sub.connect()]);
  io.adapter(createAdapter(pub, sub));
  console.log("[Socket.IO] Redis-Adapter aktiviert");
}
```

### Phase 2: Litestream einrichten

#### Schritt 2.1 – Litestream installieren (beide Nodes)

```bash
# Auf jedem Node:
wget https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.tar.gz
tar -xzf litestream-v0.3.13-linux-amd64.tar.gz
sudo mv litestream /usr/local/bin/
```

#### Schritt 2.2 – Litestream Konfiguration

```yaml
# /etc/litestream.yml (Primary)
dbs:
  - path: /home/multibase/multibase2/dashboard/backend/prisma/data/dev.db
    replicas:
      - type: s3
        bucket: multibase-backup
        path: db/dashboard.db
        endpoint: https://s3.eu-central-1.amazonaws.com    # oder MinIO/Hetzner
        region: eu-central-1
        # Credentials via AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
        sync-interval: 1s      # Replikationsintervall
```

```yaml
# /etc/litestream.yml (Replica)
dbs:
  - path: /home/multibase/multibase2/dashboard/backend/prisma/data/dev.db
    replicas:
      - type: s3
        bucket: multibase-backup
        path: db/dashboard.db
        endpoint: https://s3.eu-central-1.amazonaws.com
        region: eu-central-1
```

#### Schritt 2.3 – Litestream als Systemd-Service

```ini
# /etc/systemd/system/litestream.service
[Unit]
Description=Litestream SQLite Replication
After=network.target

[Service]
# Primary: replicate (streamt zu S3)
# Replica: replicate (restored und hält sync)
ExecStart=/usr/local/bin/litestream replicate -config /etc/litestream.yml
Restart=always
User=multibase
Environment=AWS_ACCESS_KEY_ID=xxx
Environment=AWS_SECRET_ACCESS_KEY=xxx

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now litestream
```

**Auf der Replica** wird vor dem ersten Start einmalig restored:

```bash
litestream restore -config /etc/litestream.yml \
  /home/multibase/multibase2/dashboard/backend/prisma/data/dev.db
```

### Phase 3: Zweiten Node einrichten

#### Schritt 3.1 – Server vorbereiten

```bash
# Auf Node B:
# 1. Multibase installieren (gleiche Schritte wie INSTALL.md)
cd /home/multibase
git clone <repo> multibase2
cd multibase2
bash deployment/install.sh

# 2. .env anpassen:
NODE_ROLE=replica
NODE_ID=node-b
REDIS_URL=redis://node-a.internal:6379   # oder eigener Redis
```

#### Schritt 3.2 – Redis extern erreichbar machen

Auf dem Redis-Host (Node A oder dedicated):

```bash
# redis.conf anpassen:
bind 0.0.0.0
requirepass <sicheres-passwort>
```

Alle Nodes verbinden sich mit:
```
REDIS_URL=redis://:passwort@redis-host:6379
```

#### Schritt 3.3 – Nginx Load-Balancer konfigurieren

Die Nginx-Konfiguration aus Abschnitt 2.5 auf dem Entry-Point-Server einrichten.
`backup`-Flag auf Node B entfernen für Active-Active, oder belassen für Active-Passive.

### Phase 4: Failover testen

#### Test 1 – Primary stoppen
```bash
# Auf Node A:
pm2 stop multibase-backend

# Erwartung:
# - Nginx routet Traffic automatisch zu Node B
# - Node B erkennt Primary-Ausfall nach 15s
# - Node B promoted sich zum Primary (Distributed Lock via Redis)
# - Litestream auf Node B wechselt von Restore zu Replicate
```

#### Test 2 – Primary wieder starten
```bash
# Auf Node A:
pm2 start multibase-backend

# Node A startet als Replica (erkennt dass Node B Primary ist)
# Manuelles Switchover möglich über:
curl -X POST http://node-a:3001/api/cluster/promote
```

#### Test 3 – WebSocket-Failover
```bash
# Frontend verbunden mit Node A
# Node A stoppen → Socket.IO reconnect zu Node B
# Health-Updates sollten weiter fließen
```

---

## 4. Neue Dateien & Änderungen

### Neue Dateien

| Datei | Beschreibung |
|-------|-------------|
| `dashboard/backend/src/services/ClusterService.ts` | Heartbeat, Node-Discovery, Failover-Logik |
| `dashboard/backend/src/routes/cluster.ts` | API-Endpunkte für Cluster-Status |
| `templates/litestream/litestream.yml` | Litestream-Konfigurationstemplate |
| `templates/systemd/litestream.service` | Systemd-Unit für Litestream |
| `templates/nginx/cluster-lb.conf` | Nginx-Upstream-Konfiguration |
| `scripts/cluster-setup.sh` | Automatisiertes Setup-Script für neue Nodes |
| `scripts/cluster-promote.sh` | Manuelles Failover-Script |

### Bestehende Dateien – Änderungen

| Datei | Änderung |
|-------|---------|
| `dashboard/backend/src/server.ts` | ClusterService starten, Socket.IO Redis-Adapter |
| `dashboard/backend/package.json` | Dependency `@socket.io/redis-adapter` |
| `dashboard/backend/ecosystem.config.js` | `NODE_ROLE`, `NODE_ID`, `REDIS_URL` Env-Vars |
| `deployment/install.sh` | Litestream-Installation, Cluster-Fragen im Setup |
| `dashboard/frontend/src/pages/` | Neue "Cluster"-Seite im Dashboard |
| `.env` / `.env.example` | Neue Env-Variablen dokumentieren |

---

## 5. Neue Umgebungsvariablen

```bash
# Cluster-Konfiguration
NODE_ID=node-a                              # Eindeutige Node-Kennung
NODE_ROLE=primary                           # primary | replica
CLUSTER_ENABLED=true                        # Cluster-Modus aktivieren

# Redis (shared)
REDIS_URL=redis://:passwort@redis-host:6379

# Litestream
LITESTREAM_S3_BUCKET=multibase-backup
LITESTREAM_S3_ENDPOINT=https://s3.eu-central-1.amazonaws.com
LITESTREAM_S3_REGION=eu-central-1
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
```

---

## 6. Frontend – Cluster Dashboard

Eine neue Seite im Dashboard zeigt den Cluster-Status:

```
┌──────────────────────────────────────────────────┐
│  Cluster Overview                                │
│                                                  │
│  ● Node A (Primary)     ● Node B (Replica)       │
│    Uptime: 14d 3h         Uptime: 14d 3h         │
│    CPU: 23%               CPU: 12%                │
│    Projekte: 5            Projekte: 3             │
│    DB: RW                 DB: RO (Sync: 0.3s)     │
│                                                  │
│  [Promote Node B]  [Demote Node A]               │
│                                                  │
│  Letzte Failover-Events:                         │
│  2026-03-01 14:22 – Node A → Node B (auto)       │
│  2026-02-28 09:15 – Node B → Node A (manuell)    │
└──────────────────────────────────────────────────┘
```

**API-Endpunkte dafür:**
- `GET /api/cluster/health` – eigener Node-Status
- `GET /api/cluster/nodes` – alle Nodes aus Redis
- `POST /api/cluster/promote` – manuelles Failover auslösen
- `GET /api/cluster/events` – Failover-History

---

## 7. Reihenfolge der Umsetzung

| #  | Aufgabe | Aufwand | Abhängig von |
|----|---------|---------|-------------|
| 1  | `ClusterService.ts` erstellen | 2h | – |
| 2  | Cluster-API-Routen (`/api/cluster/*`) | 1h | #1 |
| 3  | Socket.IO Redis-Adapter einbauen | 30min | – |
| 4  | `server.ts` anpassen (Cluster-Init) | 1h | #1, #3 |
| 5  | Litestream auf Primary installieren + konfigurieren | 1h | – |
| 6  | S3/MinIO-Bucket einrichten | 30min | – |
| 7  | Litestream Systemd-Service | 30min | #5, #6 |
| 8  | Zweiten Node aufsetzen (Clone, Install) | 2h | #7 |
| 9  | Litestream Restore auf Replica | 30min | #7, #8 |
| 10 | Redis extern erreichbar machen | 30min | – |
| 11 | Nginx Load-Balancer konfigurieren | 1h | #8 |
| 12 | Failover-Tests durchführen | 2h | #1–#11 |
| 13 | Frontend Cluster-Seite bauen | 3h | #2 |
| 14 | `deployment/install.sh` Cluster-Support | 2h | #5–#11 |
| 15 | Dokumentation aktualisieren | 1h | alles |

**Gesamtaufwand: ~18h**

---

## 8. Risiken & Mitigationen

| Risiko | Mitigation |
|--------|-----------|
| Split-Brain (beide denken sie sind Primary) | Redis Distributed Lock mit TTL, nur ein Primary möglich |
| Datenverlust bei Failover | Litestream synct < 1s, max. 1s Datenverlust. Akzeptabel für Dashboard-Metadaten |
| Redis fällt aus | Fallback: Node arbeitet standalone weiter, kein Failover möglich bis Redis zurück |
| SQLite Locking bei gleichzeitigem Schreiben | Nur Primary schreibt, Replicas sind read-only. Prisma-Client erhält Middleware die Writes auf Replica blockt |
| Litestream-Lag | Monitoring via `litestream generations` und Alert bei Lag > 5s |

---

## 9. Alternativen (bewusst verworfen)

| Alternative | Grund für Ablehnung |
|-------------|-------------------|
| PostgreSQL-Migration | Hoher Aufwand (Schema, Prisma, Hosting), SQLite reicht für Dashboard-Daten |
| LiteFS (Fly.io) | Erfordert FUSE, komplex in Nicht-Fly-Umgebungen |
| CockroachDB | Overshoot – verteilte DB für ein Dashboard unnötig |
| Kubernetes | Massive Komplexität, widerspricht "so einfach wie möglich" |
| Docker Swarm | Zusätzliche Orchestrierung, PM2 + Nginx reicht |

---

## 10. Minimal Viable Cluster (Schnellster Weg)

Wer den Cluster-Support so schnell wie möglich haben will, braucht nur:

1. **Redis extern erreichbar machen** (30 min)
2. **Socket.IO Redis-Adapter einbauen** (30 min)
3. **Litestream installieren + konfigurieren** (1h)
4. **Zweiten Node aufsetzen** (2h)
5. **Nginx Upstream konfigurieren** (1h)

→ **~5h für einen funktionierenden Active-Passive Cluster.**

Die Cluster-API, das Dashboard-UI und das automatisierte Failover können danach
schrittweise nachgezogen werden.
