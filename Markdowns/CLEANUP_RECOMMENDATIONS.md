# 🧹 Projekt-Aufräum-Empfehlungen (FINAL VERIFIZIERT)

Diese Liste deckt nun sowohl das **Root-Verzeichnis** (`~/multibase`) als auch das **Dashboard-Verzeichnis** (`~/multibase/dashboard`) ab, basierend auf Ihrer Screenshot-Anfrage und dem Deep-Scan.

---

## 📂 1. Hauptverzeichnis (`~/multibase`)

### 🚨 KRITISCH: MUSS BLEIBEN! (Nicht löschen oder verschieben)

Diese Dateien werden vom Backend benötigt oder sind essentielle Konfigurationen.

- `supabase_manager.py` (Wird vom Backend ausgeführt)
- `supabase_setup.py` (Wird importiert)
- `requirements.txt` (Python Abhängigkeiten)
- `docker-compose.yml`
- `.env`

### ✅ Aufräumen (Verschieben nach `_ARCHIVE/legacy_scripts`)

Diese Dateien werden **nicht** mehr vom Code referenziert.

- `generate_keys.py`
- `test_security.py`
- `test_supabase_setup.py`
- `update_env_credentials.py`
- `update_security.py`
- `setup_secure_supabase.sh`

### ✅ Aufräumen (Verschieben nach `_ARCHIVE/legacy_sql`)

Diese `.sql` Dateien im Root sind lose und ungenutzt.

- `_supabase.sql`
- `enable_logical_replication.sql`
- `init_analytics.sql`
- `init_analytics_schema.sql`
- `sample_security_policies.sql`

---

## 📂 2. Dashboard-Verzeichnis (`~/multibase/dashboard`)

Hier haben Sie Ihren Screenshot gemacht.

### 🚨 KRITISCH: MUSS BLEIBEN!

Das sind Ihre Start-Skripte für das Dashboard. Wenn Sie diese löschen, können Sie das Dashboard nicht mehr bequem starten.

- `launch.sh` (Haupt-Startskript für Linux/Mac)
- `start.ps1` (Start-skript für **Windows** - Sehr wichtig für Sie!)
- `stop.sh` (Hilfsskript zum Beenden)
- `status.sh` (Status-Check)
- `scripts/` (Ordner mit Hilfs-Skripten)

### 📄 Dokumentation (Verschieben nach `../Markdowns` oder `docs/`)

Diese Markdown-Dateien blähen den Ordner auf und können bedenkenlos verschoben werden.

- `COMPLETION.md`
- `DEPLOYMENT.md`
- `Production_deployment.md`
- `PROJECT_COMPLETE.md`
- `QUICKSTART.md`
- `QUICK_REFERENCE.md`
- `SCRIPTS.md`
- `SYSTEM_AUDIT.md`

### 🗑️ Optional löschbar

- `package-lock.json` (Ist fast leer und hat keine Abhängigkeiten, kann weg, wenn es stört)

---

## 🏁 Zusammenfassung für Windows-User

1.  **Verschieben Sie die Python-Skripte im ROOT (`supabase_manager.py`...) ZURÜCK ins Root**, falls schon verschoben.
2.  Lassen Sie `start.ps1` im Dashboard-Ordner.
3.  Alles, was auf `.md` endet, können Sie in einen Doku-Ordner packen, um Übersicht zu schaffen.
