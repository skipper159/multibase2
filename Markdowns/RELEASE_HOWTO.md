# Release-Anleitung für Multibase

## Voraussetzungen

- Alle gewünschten Features/Fixes sind auf `Feature_Roadmap` committed & gepusht
- CI-Tests auf `Feature_Roadmap` sind grün (GitHub Actions → `test.yml`)
- Lokaler Branch: `Feature_Roadmap` ist aktuell (`git pull`)

---

## Schritt 1 — Feature_Roadmap nach main mergen

### Via GitHub Web

1. Öffne `https://github.com/skipper159/multibase2/pull/new/Feature_Roadmap`
2. **Base:** `main` | **Compare:** `Feature_Roadmap`
3. Titel & Beschreibung ausfüllen → **Create pull request**
4. Auf der PR-Seite: **Merge pull request** → **Confirm merge**

### Via Terminal (Windows PowerShell)

```powershell
cd C:\Users\thoma\Multibase\multibase

# Sicherstellen dass alles gepusht ist
git push origin Feature_Roadmap

# GitHub-Token holen (im Credential-Store gespeichert)
$input = "protocol=https`nhost=github.com`n`n"
$cred  = $input | git credential fill
# Ausgabe enthält: username=... password=gho_...
# Token merken — wird unten gebraucht

# PR erstellen via GitHub API
$token   = "gho_DEIN_TOKEN_HIER"
$headers = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json" }
$body    = @{
    title = "feat: Kurze Beschreibung (vX.X.X)"
    head  = "Feature_Roadmap"
    headOwner = "skipper159"
    base  = "main"
    body  = "Beschreibung der Änderungen"
} | ConvertTo-Json
$pr = Invoke-RestMethod -Uri "https://api.github.com/repos/skipper159/multibase2/pulls" `
      -Method POST -Headers $headers -Body $body -ContentType "application/json"
Write-Host "PR #$($pr.number): $($pr.html_url)"

# PR mergen
$mergeBody = @{ merge_method = "merge" } | ConvertTo-Json
Invoke-RestMethod -Uri "https://api.github.com/repos/skipper159/multibase2/pulls/$($pr.number)/merge" `
    -Method PUT -Headers $headers -Body $mergeBody -ContentType "application/json"
Write-Host "Merged!"
```

---

## Schritt 2 — Version bumpen & Release erstellen

### Via GitHub Web

1. Öffne `https://github.com/skipper159/multibase2/actions/workflows/release.yml`
2. Klick **Run workflow** (oben rechts)
3. Branch: `main`
4. **bump:** `patch` / `minor` / `major` wählen
   - `patch` → 3.0.12 → 3.0.13 (Bugfixes, kleine Änderungen)
   - `minor` → 3.0.x → 3.1.0 (neue Features)
   - `major` → 3.x.x → 4.0.0 (Breaking Changes)
5. **notes:** Kurze Release-Notiz (optional)
6. **Run workflow** klicken

> ⚠️ **Bekannter Bug:** Der Workflow kann mit `startup_failure` scheitern (liegt an `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`).  
> In dem Fall → Schritt 2b (manuell via Terminal).

### Via Terminal (Windows PowerShell) — empfohlen

```powershell
cd C:\Users\thoma\Multibase\multibase

# Auf main wechseln & aktualisieren
git checkout main
git pull origin main

# Aktuelle Version prüfen
node -e "console.log(require('./dashboard/backend/package.json').version)"

# Version bumpen (Beispiel: patch → 3.0.12 → 3.0.13)
# Für minor: 3.0.x → 3.1.0 | Für major: x.0.0 → (x+1).0.0
$newVersion = "3.0.13"   # <-- HIER ANPASSEN
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('dashboard/backend/package.json', 'utf8'));
  pkg.version = '$newVersion';
  fs.writeFileSync('dashboard/backend/package.json', JSON.stringify(pkg, null, 2) + '\n');
  console.log('Version bumped to ' + pkg.version);
"

# Committen & pushen
git add dashboard/backend/package.json
git commit -m "chore: bump version to $newVersion"
git push origin main

# Git-Tag erstellen & pushen
git tag -a "v$newVersion" -m "Release v$newVersion"
git push origin "v$newVersion"

# GitHub Release via API erstellen
$token   = "gho_DEIN_TOKEN_HIER"
$headers = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json" }

# Changelog aus Commits seit letztem Tag generieren
$changelog = git log "v$(node -e "console.log(require('./dashboard/backend/package.json').version)" | % { $_ -replace $newVersion, '' })..v$newVersion" --no-merges --pretty=format:"- %s" 2>$null
# Alternativ manuell:
$changelog = "- Beschreibung der wichtigsten Änderungen"

$releaseBody = @{
    tag_name   = "v$newVersion"
    name       = "v$newVersion"
    body       = $changelog
    draft      = $false
    prerelease = $false
    make_latest = "true"
} | ConvertTo-Json
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/skipper159/multibase2/releases" `
           -Method POST -Headers $headers -Body $releaseBody -ContentType "application/json"
Write-Host "Release erstellt: $($release.html_url)"
```

---

## Schritt 3 — Backend auf VPS2 deployen

### Via GitHub Web

1. Öffne `https://github.com/skipper159/multibase2/actions/workflows/deploy-backend.yml`
2. **Run workflow** → Branch `main` → **Run workflow**
3. Warten bis der Workflow grün ist (~3 min)

### Via Terminal

```powershell
$token   = "gho_DEIN_TOKEN_HIER"
$headers = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json" }
$body    = @{ ref = "main" } | ConvertTo-Json
Invoke-RestMethod -Uri "https://api.github.com/repos/skipper159/multibase2/actions/workflows/deploy-backend.yml/dispatches" `
    -Method POST -Headers $headers -Body $body -ContentType "application/json"
Write-Host "Deploy-Backend Workflow gestartet"

# Status prüfen (nach ~30s)
Start-Sleep -Seconds 30
$runs = Invoke-RestMethod -Uri "https://api.github.com/repos/skipper159/multibase2/actions/workflows/deploy-backend.yml/runs?per_page=1" -Headers $headers
$runs.workflow_runs[0] | Select-Object status, conclusion, html_url
```

---

## Schritt 4 — Frontend auf VPS1 deployen (bei UI-Änderungen)

### Via GitHub Web

1. Öffne `https://github.com/skipper159/multibase2/actions/workflows/deploy.yml`
2. **Run workflow** → Branch `main` → **Run workflow**

### Via Terminal

```powershell
$token   = "gho_DEIN_TOKEN_HIER"
$headers = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json" }
$body    = @{ ref = "main" } | ConvertTo-Json
Invoke-RestMethod -Uri "https://api.github.com/repos/skipper159/multibase2/actions/workflows/deploy.yml/dispatches" `
    -Method POST -Headers $headers -Body $body -ContentType "application/json"
Write-Host "Deploy-Frontend Workflow gestartet"
```

---

## Schritt 5 — Verifizieren

```powershell
# Neusten Release prüfen
$token   = "gho_DEIN_TOKEN_HIER"
$headers = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json" }
Invoke-RestMethod -Uri "https://api.github.com/repos/skipper159/multibase2/releases/latest" -Headers $headers |
    Select-Object tag_name, published_at, html_url

# Backend auf VPS2 Version prüfen
ssh webtropia2 'sudo -u multibase pm2 list'
ssh webtropia2 'cat /opt/multibase/dashboard/backend/package.json | grep version'

# Backend-Logs prüfen
ssh webtropia2 'tail -20 /opt/multibase/logs/backend-out.log'
```

---

## Bekannte Probleme & Fixes

| Problem                                                 | Ursache                                                | Fix                                                                                                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `startup_failure` bei release.yml                       | `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` ist Boolean | Release manuell via Terminal (Schritt 2 Terminal)                                                                                                                                |
| `insufficient permission for .git/objects`              | `.git` gehört root, PM2 läuft als `multibase`          | `ssh webtropia2 'chown -R multibase:multibase /opt/multibase/.git'`                                                                                                              |
| `git fetch origin Feature_Roadmap` schlägt fehl         | `GIT_UPDATE_BRANCH` noch auf altem Branch              | `ssh webtropia2 'sed -i "s/GIT_UPDATE_BRANCH=.*/GIT_UPDATE_BRANCH=main/" /opt/multibase/dashboard/backend/.env && sudo -u multibase pm2 restart multibase-backend --update-env'` |
| PM2 zeigt alte Version                                  | Deployment wurde noch nicht ausgeführt                 | Deploy-Backend Workflow triggern (Schritt 3)                                                                                                                                     |
| `No commits between main and Feature_Roadmap` (PR-Tool) | VS Code Extension nutzt falschen Repo-Owner            | `headOwner: "skipper159"` + `repo: {owner: "skipper159", name: "multibase2"}` im PR-Tool angeben                                                                                 |

---

## Kurzreferenz — Welcher GitHub-Token?

Der Token wird automatisch aus dem Windows Credential Manager geladen:

```powershell
$input = "protocol=https`nhost=github.com`n`n"
$cred  = $input | git credential fill
# Zeigt: username=skipper159 password=gho_...
```

Der Token beginnt mit `gho_` und ändert sich gelegentlich (GitHub OAuth Token).  
Falls abgelaufen: `https://github.com/settings/tokens` → neuen Token erstellen.
