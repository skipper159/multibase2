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
- ✅ Shared Compose configuration validation
- ✅ Live local `docker exec` smoke test against `multibase-db`
