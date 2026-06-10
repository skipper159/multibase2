# Self-Update System

Multibase includes a built-in self-update system accessible at **Settings → Updates**. It allows admins to update the Multibase dashboard and pull the latest Supabase Docker images — directly from the UI, with live log streaming.

---

## How It Works

When you click **Update Multibase**, the backend:

1. Pulls the latest code from `origin/main` via `git`
2. Installs backend dependencies (including `devDependencies` for TypeScript compilation)
3. Compiles the backend TypeScript source
4. Builds and deploys the frontend *(local mode)* or builds and rsyncs it to a separate frontend server *(split mode)*
5. Restarts the backend via PM2

All steps stream live output to the terminal panel in the UI via Socket.IO.

---

## FRONTEND_SERVE Modes

Set `FRONTEND_SERVE` in your `.env` to control how the frontend is handled during updates.

### `local` — Single Server

Both frontend and backend run on the same machine. The update process builds the frontend (`vite build`) and serves it from the same server.

```env
FRONTEND_SERVE=local
```

**Update steps:**
```
git pull → backend install → frontend build → pm2 restart
```

### `split` — Multi-Server (Backend + Frontend on separate VPS)

The backend lives on VPS2, the frontend is served statically from VPS1. During an update, the backend builds the frontend and rsyncs the `dist/` folder to VPS1 over SSH.

```env
FRONTEND_SERVE=split
```

Requires additional VPS1 variables (see below).

**Update steps:**
```
git pull → backend install → frontend build → frontend deploy (rsync) → pm2 restart
```

> If `FRONTEND_SERVE=split` but no VPS1 variables are set, the frontend build and deploy steps are **skipped** — useful if CI/CD handles frontend deployment separately.

---

## Environment Variables

### Core

| Variable | Description | Default |
|---|---|---|
| `FRONTEND_SERVE` | `local` or `split` | `local` |
| `BACKEND_URL` | Used as `VITE_API_URL` when building the frontend | — |

### Split Mode — VPS1 rsync (required for auto frontend deploy)

| Variable | Description | Example |
|---|---|---|
| `VPS1_HOST` | IP or hostname of the frontend server | `46.228.205.184` |
| `VPS1_USER` | SSH user on VPS1 | `deploy` |
| `VPS1_KEY` | Path to the private SSH key on VPS2 | `/home/multibase/.ssh/id_ed25519` |
| `VPS1_FRONTEND_PATH` | Absolute path to the web root on VPS1 | `/var/www/multibase` |

---

## Split Mode: One-Time SSH Setup

This needs to be done once to allow VPS2 to connect to VPS1 without a password.

### 1. Generate SSH keypair on VPS2

```bash
ssh root@VPS2
mkdir -p /home/multibase/.ssh
chmod 700 /home/multibase/.ssh
ssh-keygen -t ed25519 -f /home/multibase/.ssh/id_ed25519 -N '' -C 'multibase-deploy'
chown -R multibase:multibase /home/multibase/.ssh
cat /home/multibase/.ssh/id_ed25519.pub
```

### 2. Authorize the key on VPS1

Copy the output of the `cat` command above, then on VPS1:

```bash
ssh root@VPS1
mkdir -p /home/YOUR_FRONTEND_USER/.ssh
chmod 700 /home/YOUR_FRONTEND_USER/.ssh
echo "ssh-ed25519 AAAA...your-public-key..." >> /home/YOUR_FRONTEND_USER/.ssh/authorized_keys
chmod 600 /home/YOUR_FRONTEND_USER/.ssh/authorized_keys
chown -R YOUR_FRONTEND_USER:YOUR_FRONTEND_USER /home/YOUR_FRONTEND_USER/.ssh
```

### 3. Pre-populate known_hosts and test

```bash
# On VPS2, as the multibase user:
su - multibase -s /bin/bash
ssh-keyscan -H VPS1_IP >> ~/.ssh/known_hosts
ssh -i ~/.ssh/id_ed25519 YOUR_FRONTEND_USER@VPS1_IP "echo SSH_OK"
# Should print: SSH_OK
```

### 4. Add VPS1 variables to `.env` on VPS2

```env
VPS1_HOST=<VPS1_IP>
VPS1_USER=<frontend_user>
VPS1_KEY=/home/multibase/.ssh/id_ed25519
VPS1_FRONTEND_PATH=/path/to/web/root
```

---

## Triggering an Update

1. Open **Settings → Updates** in the Multibase dashboard
2. Click **Check for Updates** to compare your current version against the latest GitHub release
3. If an update is available, a yellow badge appears: *Update available*
4. Click **Update Multibase** — then confirm
5. Watch the live terminal: each step appears as it runs
6. After PM2 restarts, the backend reconnects automatically

---

## Version Detection

The **current version** is read from `dashboard/backend/package.json` on the server.

The **latest version** is fetched from:
1. GitHub Releases API: `https://api.github.com/repos/YOUR_USERNAME/multibase2/releases/latest`
2. Fallback: raw `package.json` from the `main` branch on GitHub

> If you fork Multibase, create GitHub Releases tagged `v3.x.x` for the version checker to work. Use the included `release.yml` workflow or create tags manually.

---

## Troubleshooting

### `husky: not found` during npm install

**Cause:** The root `package.json` runs `husky` in `prepare`. Husky is a devDependency not present on production servers.

**Fix:** Make sure `NODE_ENV=production` is set in your `.env`. The prepare script skips Husky automatically:
```json
"prepare": "[ \"$NODE_ENV\" = 'production' ] || husky || true"
```

---

### `.git/objects` permission error during `git fetch`

```
error: insufficient permission for adding an object to repository database .git/objects
```

**Cause:** A previous deploy as `root` left some `.git` objects owned by root.

**Fix:**
```bash
chown -R multibase:multibase /opt/multibase/.git
```

---

### rsync fails: `Permission denied (publickey)`

**Fix:**
1. Verify the public key is in VPS1's `authorized_keys`
2. Run `ssh-keyscan -H VPS1_IP >> /home/multibase/.ssh/known_hosts` on VPS2
3. Test: `su - multibase -s /bin/bash -c 'ssh -i ~/.ssh/id_ed25519 USER@VPS1 echo OK'`

---

### `tsc` fails: `Cannot find module 'vitest'`

**Cause:** Backend installed without devDependencies — `@types/*` and test types are missing.

**Fix:** The UpdateService uses `--include=dev` automatically. For manual deploys:
```bash
npm install --prefer-offline --include=dev --ignore-scripts
npm run build
npm prune --omit=dev
```

---

## Related

- [Split Hosting Deployment](/setup/deployment/split-hosting)
- [Environment Variables](/setup/configuration/environment)
- [GitHub Actions](/setup/deployment/github-actions)
