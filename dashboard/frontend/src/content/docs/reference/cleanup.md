# 🧹 Project Cleanup Recommendations (FINAL VERIFIED)

This list covers both the **root directory** (`~/multibase`) and the **dashboard directory** (`~/multibase/dashboard`), based on the requested screenshot review and the deep scan.

---

## 📂 1. Root Directory (`~/multibase`)

### 🚨 CRITICAL: MUST REMAIN! (Do not delete or move)

These files are required by the backend or contain essential configuration.

- `supabase_manager.py` (Executed by the backend)
- `supabase_setup.py` (Imported by the application)
- `requirements.txt` (Python dependencies)
- `docker-compose.yml`
- `.env`

### ✅ Cleanup (Move to `_ARCHIVE/legacy_scripts`)

These files are no longer referenced by the codebase.

- `generate_keys.py`
- `test_security.py`
- `test_supabase_setup.py`
- `update_env_credentials.py`
- `update_security.py`
- `setup_secure_supabase.sh`

### ✅ Cleanup (Move to `_ARCHIVE/legacy_sql`)

These `.sql` files in the root directory are loose and unused.

- `_supabase.sql`
- `enable_logical_replication.sql`
- `init_analytics.sql`
- `init_analytics_schema.sql`
- `sample_security_policies.sql`

---

## 📂 2. Dashboard Directory (`~/multibase/dashboard`)

This is where the screenshot review was performed.

### 🚨 CRITICAL: MUST REMAIN!

These are the dashboard startup scripts. Removing them would make the dashboard harder to start.

- `launch.sh` (Main startup script for Linux/macOS)
- `start.ps1` (Startup script for **Windows**)
- `stop.sh` (Shutdown helper script)
- `status.sh` (Status check)
- `scripts/` (Helper scripts directory)

### 📄 Documentation (Move to `../Markdowns` or `docs/`)

These Markdown files are not part of the runtime and can be moved to a documentation directory if desired.

- `COMPLETION.md`
- `DEPLOYMENT.md`
- `Production_deployment.md`
- `PROJECT_COMPLETE.md`
- `QUICKSTART.md`
- `QUICK_REFERENCE.md`
- `SCRIPTS.md`
- `SYSTEM_AUDIT.md`

### 🗑️ Optional cleanup

- `package-lock.json` (Only remove if it is genuinely unused; package lockfiles are normally required for reproducible installs.)

---

## 🏁 Summary for Windows Users

1. **Move the Python scripts back to the root directory** (`supabase_manager.py`, etc.) if they were moved elsewhere.
2. Keep `start.ps1` in the dashboard directory.
3. Move files ending in `.md` to a documentation directory to keep the project organized, if desired.
