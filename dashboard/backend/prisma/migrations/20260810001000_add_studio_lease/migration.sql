-- CreateTable
CREATE TABLE "StudioLease" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantName" TEXT NOT NULL,
    "studioPort" INTEGER NOT NULL,
    "activatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAccessAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "StudioLease_tenantName_key" ON "StudioLease"("tenantName");

-- CreateIndex
CREATE INDEX "StudioLease_tenantName_idx" ON "StudioLease"("tenantName");

-- CreateIndex
CREATE INDEX "StudioLease_status_idx" ON "StudioLease"("status");
