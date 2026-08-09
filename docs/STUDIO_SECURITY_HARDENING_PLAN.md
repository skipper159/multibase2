# Plan: Temporäre Studio-Container sicher und zuverlässig betreiben

**Status:** Umgesetzt (Phasen 1-4)  
**Betroffene Komponente:** Shared Studio / tenant-spezifische Studio- und pg-meta-Container  
**Priorität:** Kritisch

## Ziel

Temporäre Studio-Container sollen weiterhin beim Öffnen eines Projekts gestartet und nach dem Schließen des Studio-Tabs automatisch beendet werden. Gleichzeitig dürfen Studio, pg-meta und Docker nicht über direkte Host-Ports oder ungeschützte Verwaltungsendpunkte angreifbar sein.

## Festgestellte Probleme

### 1. Direkte öffentliche Portfreigabe

`StudioManager` startet tenant-spezifische Studio-Container aktuell mit:

```text
-p <port>:3000
```

Damit bindet Docker den Port auf allen Interfaces. Der vorgesehene Nginx-Proxy und die TLS-Zertifikate verhindern den direkten Zugriff auf diese Ports nicht.

**Zielzustand:**

```text
-p 127.0.0.1:<port>:3000
```

Der externe Zugriff erfolgt ausschließlich über den Host-Nginx mit Authentifizierung und TLS.

### 2. Ungeschützte Studio-Verwaltungsrouten

Die Routen unter `/api/studio` aktivieren, deaktivieren und verlängern die Lebensdauer von Containern. Sie müssen eine echte Authentifizierung und Berechtigungsprüfung erzwingen. Ein passives API-Key-Middleware reicht dafür nicht.

**Zu schützen:**

- `POST /api/studio/activate/:tenantName`
- `POST /api/studio/deactivate`
- `POST /api/studio/heartbeat/:tenantName`
- `GET /api/studio/active`

Die Aktivierung soll nur für berechtigte Benutzer und nur für Tenants der zulässigen Organisation möglich sein. Zusätzlich sind Rate-Limits und eine Audit-Protokollierung mit Benutzerkennung, Tenant und Quell-IP erforderlich.

### 3. Docker-Socket im Studio-Container

Studio erhält derzeit den Host-Docker-Socket. Ein kompromittiertes Studio wäre damit ein möglicher Weg zur Kontrolle der gesamten Docker-Umgebung.

**Zielzustand:**

- Docker-Socket nicht in Studio mounten.
- Falls Studio bestimmte Containerinformationen benötigt: dedizierte Backend-Funktion oder restriktiver Docker-API-Proxy.
- Nur explizit erlaubte Aktionen und Container anzeigen bzw. ausführen.
- Keine beliebigen `exec`, `run`, `mount` oder privilegierten Aktionen aus dem Studio-Kontext.

### 4. Idle-Cleanup ist nicht restartfest

Der aktuelle Idle-Status liegt nur im Speicher des Dashboard-Backends. Nach einem Backend-Neustart kennt der Prozess bereits laufende temporäre Container nicht mehr; diese können dadurch dauerhaft weiterlaufen.

**Zielzustand:**

- Lease-Zustand persistent in Redis oder PostgreSQL speichern.
- Beim Backend-Start alle `multibase-studio-*` und `multibase-meta-*`-Container erkennen.
- Verwaiste oder abgelaufene Container automatisch stoppen und entfernen.
- Cleanup muss auch bei Backend-Neustart, Maschinenneustart und Prozessabsturz funktionieren.
- Container nur für die tatsächlich aktive Session bzw. den aktiven Lease am Leben halten.

### 5. Heartbeat an das falsche Browserfenster koppeln

Der Heartbeat läuft aktuell im Dashboard-Fenster, das den Studio-Tab öffnet. Wird das Dashboard-Fenster geschlossen, während Studio noch offen ist, läuft der Heartbeat nicht weiter. Wird Studio anders geöffnet, gibt es möglicherweise überhaupt keinen Heartbeat.

**Zielzustand:**

- Heartbeat aus der Studio-Seite selbst oder über eine eindeutig sessiongebundene Lease-Verbindung senden.
- Lease-Token serverseitig ausstellen und beim Heartbeat prüfen.
- Bei Tab-Schließung zusätzlich `sendBeacon` oder vergleichbare Best-Effort-Abmeldung verwenden.
- Serverseitiger Timeout bleibt die verlässliche letzte Absicherung.

## Umsetzung in Phasen

### Phase 0 – Absicherung und Beweissicherung

1. Studio nicht erneut öffentlich öffnen, bis die Verwaltungsrouten abgesichert sind.
2. Laufende verdächtige Prozesse und Containerzustände dokumentieren.
3. PostgreSQL-, JWT-, Service- und Dashboard-Secrets rotieren.
4. Studio- und Meta-Images auf bekannte, gepatchte Versionen aktualisieren und künftig pinnen.
5. Zugriff auf Studio und Backend vorübergehend auf benötigte IPs/VPN beschränken.

### Phase 1 – Authentifizierung und Autorisierung

1. `requireAuth` auf alle `/api/studio`-Routen anwenden.
2. Für Aktivierung und Deaktivierung mindestens Schreibrechte bzw. Admin-/Owner-Rechte verlangen.
3. Organisation- und Tenant-Zugehörigkeit serverseitig prüfen.
4. CSRF-Schutz für Cookie-basierte Sessions ergänzen; Bearer-Tokens nicht unkontrolliert aus URL-Parametern übernehmen.
5. Rate-Limit für Aktivierungen und Heartbeats einführen.
6. Audit-Log um Benutzer, Organisation, Tenant, Quell-IP, Ergebnis und Container-ID erweitern.

### Phase 2 – Netzwerk und Proxy

1. Temporäre Studio-Container nur an `127.0.0.1` binden.
2. Direkte Docker-Portfreigaben für Studio vollständig vermeiden, wenn ein interner Proxy möglich ist.
3. Host-Nginx als einzigen externen Eintrittspunkt verwenden.
4. Proxy-Routen mit Authentifizierung, korrektem Hostnamen und TLS erzwingen.
5. Nicht benötigte Tenant-Ports aus Docker und Firewall entfernen.
6. Externe Tests automatisieren: direkte Portzugriffe müssen fehlschlagen, der HTTPS-Proxy muss funktionieren.

### Phase 3 – Docker-Isolation

1. Docker-Socket aus den Studio-Containern entfernen.
2. Erforderliche Verwaltungsfunktionen in das Backend verlagern.
3. Backend-Dockerzugriff über eine Allowlist auf bekannte Container und Aktionen begrenzen.
4. Studio-Container ohne unnötige Root-Rechte, Capabilities und Dateisystem-Mounts starten.
5. Funktionsverzeichnisse nur mit dem minimal notwendigen Zugriff mounten.
6. Images mit festen Digests oder geprüften Versions-Tags verwenden.

### Phase 4 – Persistentes Lease- und Cleanup-Modell

1. Datenmodell für `studio_leases` definieren: Tenant, Benutzer, Session, Container-IDs, Ports, `last_seen`, Ablaufzeit und Status.
2. Lease bei erfolgreicher Aktivierung anlegen oder verlängern.
3. Heartbeat nur mit gültigem Lease-Token akzeptieren.
4. Bei fehlendem Heartbeat nach dem Timeout Studio und Meta stoppen.
5. Beim Backend-Start Docker-Zustand gegen die persistenten Leases abgleichen.
6. Verwaiste Container stoppen und entfernen.
7. Cleanup, Race-Conditions und parallele Aktivierungen testen.

### Phase 5 – Tests und Betrieb

1. Unauthentifizierte Aktivierung, Deaktivierung und Heartbeats testen.
2. Zugriff auf `:3100`, `:3101` und weitere temporäre Ports von außen testen.
3. Zugriff über den vorgesehenen HTTPS-Proxy testen.
4. Backend-Neustart bei offenem und geschlossenem Studio simulieren.
5. Browser-Tab schließen, Dashboard-Fenster schließen und Browser-Absturz simulieren.
6. Überprüfen, dass ein Tenant nicht auf Container oder Daten eines anderen Tenants zugreifen kann.
7. Lasttest auf wiederholte Aktivierungen durchführen.
8. Monitoring und Alarmierung für neue unbekannte `multibase-studio-*`, `multibase-meta-*` und Prozesse unter `/tmp` einrichten.

## Akzeptanzkriterien

- Ohne gültige Session kann kein Studio-Container aktiviert oder deaktiviert werden.
- Temporäre Studio-Ports sind aus dem Internet nicht direkt erreichbar.
- Studio ist weiterhin über den vorgesehenen HTTPS-Proxy erreichbar.
- Ein geschlossenes Studio wird innerhalb des definierten Timeouts beendet.
- Verwaiste Container werden spätestens beim nächsten Cleanup-Intervall oder Backend-Start erkannt.
- Ein Backend-Neustart lässt keine unkontrollierten Studio-Container zurück.
- Studio besitzt keinen direkten Docker-Socket mehr.
- Alle Aktivierungen und Bereinigungen sind nachvollziehbar protokolliert.

## Technische Referenzen

- `dashboard/backend/src/services/StudioManager.ts`
- `dashboard/backend/src/routes/studio.ts`
- `dashboard/frontend/src/lib/studioHeartbeat.ts`
- `docs/PORT_REFERENCE.md`
- `PRODUCTION_READINESS_PLAN.md`

