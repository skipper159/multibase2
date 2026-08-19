# Multibase 3.1.14

Release date: 2026-08-19

## Landing page and project positioning

- 🧭 Reworked the public landing page around Multibase as an open-source project rather than a commercial company or SaaS product.
- 🐳 Removed the generic “Open Source · Docker-Native · Self-Hosted” badge and its animated status dot.
- 📝 Replaced promotional hero copy with a direct description of running multiple Supabase projects on infrastructure you control.
- 🧩 Kept the complete feature overview and interactive dashboard tour while making the descriptions more precise and less promotional.
- 📊 Renamed the comparison section to “How Multibase compares” and replaced misleading claims such as “Unlimited” with resource-aware wording.
- 🔐 Reframed the security section around concrete controls instead of broad “enterprise-grade” claims.
- 🤖 Presented the AI assistant as an optional, provider-configured feature and clarified that provider usage and costs remain the user’s responsibility.
- 🧰 Reworded the extension marketplace and deployment sections to describe the actual workflow without artificial urgency or exaggerated promises.

## Project and licensing information

- 🏷️ Updated the footer from “Multibase Inc.” to “Multibase contributors”.
- ⚖️ Added the MIT License reference to the footer.
- 🗂️ Renamed the footer’s “Company” area to “Project” and kept GitHub, Issues, Discussions, and Feature Requests as the relevant links.

## Versioning and validation

- 📦 Updated root, frontend, backend, and lockfile versions to `3.1.14`.
- ⚙️ Updated the installer’s displayed main-branch version to `3.1.14`.
- ✅ Frontend TypeScript check and production build completed successfully.

# Multibase 3.1.13

Release date: 2026-08-11

## Highlights

- 🐳 Restored full Docker functionality for Workspace, Shared Infrastructure, backups, temporary Studio containers, pg-meta, Nginx gateway reloads, and image updates.
- 🔌 Replaced the restrictive Docker Socket Proxy path with a controlled direct Unix socket or Windows named-pipe connection.
- 🧭 Added explicit Docker access-mode validation so stale TCP proxy settings cannot silently break the backend.
- 🛡️ Kept the direct Docker integration argument-safe and shell-free for Docker CLI operations, including `docker exec`.

## Docker access and deployment

- The installer now generates `DOCKER_ACCESS_MODE=socket` and `DOCKER_SOCKET_PATH` instead of configuring `DOCKER_HOST=tcp://127.0.0.1:2378`.
- Existing installations are migrated automatically by `install.sh --update`.
- In split hosting mode, `install.sh --update` now synchronizes the generated frontend bundle to the configured VPS1 target via `rsync`.
- The installer verifies Docker access for the `multibase` service user with `docker info` and an actual `docker exec` smoke test.
- Legacy `multibase-docker-proxy` containers are removed during update, fresh installation, and uninstall.
- The shared Compose stack no longer deploys or advertises a Docker proxy service.
- Documentation now explains the platform-specific socket paths and the security implications of Docker-group membership.

## Backend and API

- 🗄️ Shared database routes continue to use `docker exec`, now through the direct-socket command wrapper.
- 🧰 Instance lifecycle, database backup/restore, shared-stack management, image rollback, Studio/Meta lifecycle, and Nginx gateway operations use argument-based Docker invocations.
- 🧪 Added regression coverage for direct socket resolution, TCP rejection, Windows named pipes, conflicting configuration, and shared database routes.
- 🔐 Existing authentication, cookie hardening, project secret permissions, and security-gate changes remain included in this release.

## Frontend and documentation

- 🗃️ Shared Databases error handling and runtime service/port reporting remain available.
- 📚 Added and updated PostgreSQL connection guidance, including the correct instance API URL and pooler usage model.
- 🎨 Preserved the service-card layout improvements and consistent dropdown styling.
- 📝 Updated environment and deployment documentation for direct Docker socket access.

## Upgrade instructions

On an existing server, pull this release and run:

```bash
sudo /opt/multibase/deployment/install.sh --update
```

The update rebuilds the backend and frontend, applies Prisma migrations, verifies direct Docker access, restarts the backend, and removes the obsolete proxy container. The server itself is not changed by creating this release; the command above performs the migration after the commit has been deployed.

## Validation

- ✅ Backend TypeScript build
- ✅ Frontend production build
- ✅ 55 backend tests
- ✅ Installer and uninstaller shell syntax checks
- ✅ Split-hosting frontend transfer to VPS1 verified against the configured target
- ✅ Shared Compose configuration validation
- ✅ Live local `docker exec` smoke test against `multibase-db`
