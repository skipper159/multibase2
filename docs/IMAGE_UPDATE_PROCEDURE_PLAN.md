# Plan: Zuverlässige Docker-Image-Updates über die Webupdate-Prozedur

**Status:** Analyse abgeschlossen, Umsetzung noch nicht begonnen  
**Priorität:** Hoch  
**Betroffene Bereiche:** Dashboard-Update-Seite, Shared-Infrastruktur, Tenant-Stacks, temporäre Studio-/Meta-Container

## 1. Zielbild

Die Update-Seite muss zuverlässig zwischen den folgenden Zuständen unterscheiden:

1. Der konfigurierte Image-Tag ist lokal vorhanden.
2. Das laufende Image entspricht dem Digest des konfigurierten Tags in der Registry.
3. Für das Image ist eine neuere freigegebene Version vorhanden.
4. Ein Update ist technisch zulässig und kann sicher ausgerollt oder zurückgerollt werden.

Der Status **„aktuell“** darf erst angezeigt werden, wenn der lokale Digest dem freigegebenen Registry-Digest entspricht. Ein laufender Container mit einem alten Tag oder einem alten `latest`-Digest darf nicht mehr als aktuell gelten.

## 2. Festgestellte Ursachen

### 2.1 Die aktuelle Statusprüfung prüft keine Registry

`UpdateService.getDockerServiceInfo()` liest derzeit nur Containername, Image-String, Tag und Laufstatus aus Docker. Es gibt keinen Registry-Aufruf, keinen Digest-Vergleich und keine Information über verfügbare neuere Versionen.

Betroffene Datei:

```text
dashboard/backend/src/services/UpdateService.ts
```

### 2.2 Der Prüfbereich ist unvollständig

Die Liste `SHARED_SERVICES` enthält nur die acht Shared-Services. Nicht erfasst werden unter anderem:

- laufende und gestoppte Tenant-Container
- temporäre `multibase-studio-*`- und `multibase-meta-*`-Container
- `multibase-redis`
- Portainer
- weitere Container außerhalb der Shared-Compose-Datei

Die Weboberfläche kann dadurch „aktuell“ anzeigen, obwohl ein projektbezogener oder gestoppter Container noch ein altes Image verwendet.

### 2.3 Die Update-Befehle verwenden nicht die vollständige Compose-Konfiguration

`performDockerUpdate()` verwendet derzeit nur:

```text
docker compose -f docker-compose.shared.yml ...
```

Die gemeinsame `.env.shared` und eine eventuell vorhandene `docker-compose.override.yml` werden nicht ausdrücklich eingebunden. Dadurch können beim Recreate wichtige Port-, Mapping- oder Image-Variablen fehlen.

### 2.4 Floating Tags und alte feste Tags werden gemischt

In der Shared-Compose-Datei werden sowohl feste Tags als auch `latest` verwendet. Ein `latest`-Tag kann sich ändern, ohne dass sich der Image-String im Container ändert. Feste Tags bleiben dagegen absichtlich auf einer alten Version, wenn sie nicht aktiv angepasst werden.

Für Produktion müssen deshalb Tag und Digest gemeinsam verwaltet werden.

## 3. Sicherheits- und Incident-Gate vor der Umsetzung

Da `multibase-db` kompromittierte Prozesse im beschreibbaren Container-Layer enthält, darf die Update-Routine nicht einfach als erste Maßnahme alle Images aktualisieren.

Vor einem produktiven Image-Update müssen:

1. Forensische Beweise des aktuellen `multibase-db`-Zustands gesichert werden.
2. Die verdächtigen Prozesse und ihre Rückkehrquelle beseitigt werden.
3. PostgreSQL-, Service-Role-, JWT-, Pooler- und Dashboard-Secrets rotiert werden.
4. Ein getestetes Backup und ein getesteter Restore vorhanden sein.
5. Der Update-Lauf in einem Wartungsfenster erfolgen.

Das DB-Image darf zunächst nicht automatisch aktualisiert werden. Ein PostgreSQL-Upgrade braucht eine eigene Kompatibilitätsprüfung, ein Backup und eine explizite Freigabe.

## 4. Zielarchitektur für Image-Versionen

### 4.1 Zentrale Image-Matrix

Eine zentrale, versionierte Datei soll die freigegebenen Images enthalten, zum Beispiel:

```text
shared/image-versions.yml
```

Die Datei soll mindestens abbilden:

```yaml
images:
  meta:
    repository: supabase/postgres-meta
    tag: v0.96.6
    digest: sha256:...
    updatePolicy: reviewed
  studio:
    repository: supabase/studio
    tag: 2026....
    digest: sha256:...
    updatePolicy: reviewed
  db:
    repository: supabase/postgres
    tag: 15.8.1.085
    digest: sha256:...
    updatePolicy: manual
```

Die konkreten Zielversionen müssen vor dem Eintrag gegen die verwendete Supabase-Stack-Version getestet werden. Die Versionsmatrix darf nicht automatisch auf das jeweils neueste Image springen.

### 4.2 Keine unkontrollierten `latest`-Tags

Für produktive Images sollen feste, geprüfte Tags und möglichst Digests verwendet werden. Das gilt insbesondere für:

- `supabase/studio`
- `supabase/logflare`
- `darthsim/imgproxy`
- `nginx`
- Redis
- Portainer

Falls `latest` aus betrieblichen Gründen beibehalten wird, muss die Update-Routine den Registry-Digest bei jedem Check vergleichen und den geplanten Rollout explizit anzeigen.

### 4.3 Gemeinsame Versionen für Shared, Tenant und temporäre Container

Die Image-Matrix muss von folgenden Erzeugern verwendet werden:

- `shared/docker-compose.shared.yml`
- Tenant-Compose-Vorlagen
- `StudioManager` für temporäre Studio-Container
- `StudioManager` oder Vorlagen für temporäre Meta-Container

Damit darf kein neuer temporärer Container mehr automatisch mit `postgres-meta:v0.87.1` erzeugt werden, während der Shared-Container bereits eine andere Version verwendet.

## 5. Funktionale Umsetzung der Statusprüfung

### Phase 1 – Datenmodell und Registry-Client

Erweitern von `DockerServiceInfo` um mindestens:

```text
repository
configuredTag
localImageId
localDigest
registryDigest
latestApprovedTag
latestApprovedDigest
updateAvailable
digestMatches
checkError
checkedAt
```

Der Registry-Client soll:

1. Repository und Tag normalisieren.
2. Den Registry-Digest für den exakten Tag lesen.
3. Für freigegebene Repositories verfügbare Tags abrufen.
4. Stable-, Release-Candidate-, Nightly- und Architektur-Tags unterscheiden.
5. Timeouts, Rate-Limits und Registry-Ausfälle sauber behandeln.
6. Niemals aus einem Registry-Fehler den Status „aktuell“ ableiten.

Bei einem nicht erreichbaren Registry-Dienst muss der Status **„Prüfung nicht möglich“** lauten.

### Phase 2 – Vollständige Container-Erfassung

Die Prüfung soll alle Docker-Container mit folgenden Kategorien erfassen:

- Shared-Infrastruktur
- aktive Tenant-Stacks
- gestoppte Tenant-Stacks
- temporäre Studio-/Meta-Container
- sonstige bekannte Infrastrukturcontainer

Zusätzlich soll die Oberfläche sichtbar machen, wenn ein Container nicht durch die zentrale Image-Matrix verwaltet wird.

### Phase 3 – Cache und manueller Check

Der Registry-Status darf kurzzeitig gecacht werden, aber:

- der Cache muss Alter und Quelle anzeigen;
- „Check for Updates“ muss den Registry-Cache umgehen;
- ein Digest-Check soll mindestens bei jedem manuellen Check stattfinden;
- die UI darf lokale Containerdaten nicht als Registry-Prüfung ausgeben.

## 6. Sichere Update-Ausführung

### 6.1 Preflight

Vor dem Update muss die Routine automatisch prüfen:

1. kein anderer Update-Lauf aktiv ist;
2. das Ziel-Image und der erwartete Digest erreichbar sind;
3. die Compose-Konfiguration mit allen Variablen gerendert werden kann;
4. alle erforderlichen Volumes und Netzwerke vorhanden sind;
5. ein Backup beziehungsweise Snapshot erfolgreich abgeschlossen wurde;
6. keine laufende DB-Forensik oder ein laufender Import blockiert wird;
7. genug Speicherplatz für altes und neues Image vorhanden ist.

### 6.2 Vollständige Compose-Auflösung

Die Routine soll eine gemeinsame Compose-Argumentliste verwenden, beispielsweise:

```text
docker compose \
  -f docker-compose.shared.yml \
  -f docker-compose.override.yml \
  --env-file .env.shared
```

Die Override-Datei darf nur eingebunden werden, wenn sie existiert. Vor dem Update muss `docker compose config` gespeichert und geprüft werden. Dadurch werden insbesondere Port-Mappings wie die Entfernung von Host-Port `5432` nicht versehentlich überschrieben.

### 6.3 Reihenfolge

Die Dienste sollen abhängigkeitsbewusst aktualisiert werden:

1. Images vorab laden und Digest verifizieren.
2. Nicht-Datenbankdienste aktualisieren.
3. Healthchecks und interne Erreichbarkeit prüfen.
4. Meta und Studio aktualisieren.
5. Tenant-Dienste nach freigegebener Matrix aktualisieren.
6. PostgreSQL nur als separaten, ausdrücklich bestätigten Vorgang aktualisieren.

Ein Update eines einzelnen Containers darf nicht stillschweigend alle abhängigen Container mit einer anderen Konfiguration neu erzeugen.

### 6.4 Healthchecks und Abbruch

Nach jedem Service müssen geprüft werden:

- Container läuft;
- Docker-Healthcheck ist `healthy`;
- interne DNS-Auflösung funktioniert;
- Meta erreicht PostgreSQL;
- Studio erreicht Meta;
- Pooler erreicht PostgreSQL;
- Gateway und die vorgesehenen Proxy-Routen antworten;
- 5432 bleibt nur dort erreichbar, wo es ausdrücklich erlaubt ist;
- 6543 funktioniert weiterhin für den Spooler.

Bei einem fehlgeschlagenen Healthcheck muss der Lauf abbrechen und den vorherigen bekannten Image-Digest wiederherstellen.

## 7. Rollback-Konzept

Vor jedem Update müssen gespeichert werden:

- vorheriger Image-Tag und Digest;
- vorherige gerenderte Compose-Konfiguration;
- Container-Umgebungs- und Mount-Metadaten ohne Secrets;
- Update-ID, Benutzer, Zeitpunkt und Ergebnis.

Rollback bedeutet:

1. Zielcontainer kontrolliert stoppen.
2. vorherigen Digest verwenden;
3. mit derselben Compose-Konfiguration neu erstellen;
4. Healthchecks erneut ausführen;
5. bei DB-Änderungen zusätzlich Restore-/Migration-Plan anwenden.

Es darf kein Rollback auf ein kompromittiertes DB-Image oder einen kompromittierten beschreibbaren Layer erfolgen.

## 8. UI- und API-Anpassungen

Die Update-Seite soll nicht mehr nur „aktuell“ anzeigen, sondern pro Container mindestens:

```text
lokaler Tag | lokaler Digest | Registry-Digest | freigegebene Zielversion | Status | Risiko
```

Empfohlene Statuswerte:

- `aktuell`
- `Update verfügbar`
- `Tag veraltet`
- `Digest abweichend`
- `Registry nicht erreichbar`
- `nicht verwaltet`
- `manuelle Freigabe erforderlich`
- `Sicherheitsprüfung blockiert`

Der Update-Button muss vor dem Start eine Zusammenfassung mit Zielversion, betroffenen Containern, Backup-Status und erwarteter Downtime anzeigen.

## 9. Tests vor Produktivfreigabe

### Unit-Tests

- Parsing von Image-Repository und Tag;
- Vergleich von lokalen und Registry-Digests;
- Erkennung eines veränderten `latest`-Tags;
- Erkennung neuer semantischer Versionen;
- Ausschluss von RC-, Nightly- und Architektur-Tags;
- Verhalten bei Timeout, 404, Rate-Limit und ungültiger Registry-Antwort;
- sichere Behandlung fehlender Override-Dateien.

### Integrations-Tests

- Test-Registry oder Mock-Registry mit altem und neuem Digest;
- `docker compose config` mit und ohne Override;
- Pull eines Test-Images;
- erfolgreicher Healthcheck;
- absichtlicher Healthcheck-Fehler mit Rollback;
- Backend-Neustart während eines Updates;
- paralleler zweiter Update-Aufruf wird abgewiesen.

### Produktionsnahe Tests

- Update zuerst auf einem Staging-Stack;
- Studio öffnen und über den Proxy erreichen;
- temporäre Studio-/Meta-Container mit der zentralen Version erzeugen;
- Studio-Tab schließen und Idle-Cleanup prüfen;
- direkte Zugriffe auf nicht freigegebene Ports prüfen;
- Port 5432 geschlossen und Port 6543 weiterhin funktionierend testen;
- Datenbank-Backup und Restore testen.

## 10. Akzeptanzkriterien

Die Umsetzung ist erst abgeschlossen, wenn:

- die UI den Registry-Digest tatsächlich prüft;
- ein veraltetes `latest`-Image als Update verfügbar erscheint;
- `multibase-meta:v0.95.2` beziehungsweise ältere temporäre Meta-Tags als veraltet erkannt werden;
- alle aktiven und gestoppten bekannten Tenant-Container im Bericht erscheinen;
- die zentrale Image-Matrix für Shared-, Tenant- und temporäre Container verwendet wird;
- Compose-Override und `.env.shared` bei jedem Update erhalten bleiben;
- vor dem Update ein Backup- und Preflight-Gate greift;
- ein fehlgeschlagener Healthcheck automatisch zum vorherigen Digest zurückkehrt;
- PostgreSQL nicht ohne separate Freigabe aktualisiert wird;
- Audit-Log und Update-Bericht nachvollziehbar sind;
- Studio weiterhin über den vorgesehenen HTTPS-Proxy funktioniert und nach Tab-Schluss bereinigt wird.

## 11. Empfohlene Reihenfolge für die Umsetzung

1. Image-Matrix und Versionspolitik festlegen.
2. Registry-Client und Digest-Status implementieren.
3. Container-Erfassung auf Tenant-, temporäre und sonstige bekannte Container erweitern.
4. Compose-Auflösung mit `.env.shared` und optionalem Override korrigieren.
5. Preflight, Backup-Gate, Healthchecks und Rollback implementieren.
6. UI-Status und Bestätigungsdialog erweitern.
7. Tenant-/Studio-/Meta-Vorlagen auf die zentrale Image-Matrix umstellen.
8. Unit-, Integrations- und Staging-Tests ausführen.
9. Erst danach freigegebene Nicht-DB-Images aktualisieren.
10. PostgreSQL und die Incident-Bereinigung als separaten Wartungsvorgang behandeln.

## 12. Betroffene Dateien

- `dashboard/backend/src/services/UpdateService.ts`
- `dashboard/backend/src/services/DockerManager.ts`
- `dashboard/backend/src/routes/updates.ts`
- `dashboard/backend/src/types/index.ts`
- `dashboard/backend/src/services/InstanceManager.ts`
- `dashboard/backend/src/services/StudioManager.ts`
- `shared/docker-compose.shared.yml`
- `shared/docker-compose.override.yml` beziehungsweise deren Erzeugung
- Tenant-Compose-Vorlagen
- `dashboard/frontend/src/content/docs/features/updates.md`
- neue zentrale Image-Matrix unter `shared/`

