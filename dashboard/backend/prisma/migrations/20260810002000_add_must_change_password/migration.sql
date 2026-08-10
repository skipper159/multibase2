-- Add a one-time password change requirement for initial administrators.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- Existing initial administrators that have never logged in must replace the
-- installer-provided password on their first login.
UPDATE "User"
SET "mustChangePassword" = true
WHERE "role" = 'admin' AND "lastLogin" IS NULL;
