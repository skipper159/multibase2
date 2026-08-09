-- CreateTable
CREATE TABLE "ImageUpdateGateApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "approvedById" TEXT NOT NULL,
    "reason" TEXT,
    "approvedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    CONSTRAINT "ImageUpdateGateApproval_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ImageUpdateGateApproval_approvedById_idx" ON "ImageUpdateGateApproval"("approvedById");

-- CreateIndex
CREATE INDEX "ImageUpdateGateApproval_expiresAt_idx" ON "ImageUpdateGateApproval"("expiresAt");

-- CreateIndex
CREATE INDEX "ImageUpdateGateApproval_revokedAt_idx" ON "ImageUpdateGateApproval"("revokedAt");
