-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('GUARD', 'SUPERVISOR', 'CLIENT', 'COMPANY_ADMIN');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rosterSyncedAt" TIMESTAMP(3),
    "overdueMinutes" INTEGER NOT NULL DEFAULT 15,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "User" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mfaCiphertext" TEXT,
    "mfaStep" BIGINT NOT NULL DEFAULT -1,

    CONSTRAINT "User_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "Grant" (
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Grant_pkey" PRIMARY KEY ("tenantId","siteId","userId")
);

-- CreateTable
CREATE TABLE "Session" (
    "tokenHash" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "LoginLimit" (
    "key" TEXT NOT NULL,
    "bucket" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "LoginLimit_pkey" PRIMARY KEY ("key","bucket")
);

-- CreateTable
CREATE TABLE "Job" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "assignmentRef" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dutyStart" TIMESTAMP(3) NOT NULL,
    "dutyEnd" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "status" "JobStatus" NOT NULL DEFAULT 'SCHEDULED',
    "startedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "clientSummary" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "Sos" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DELIVERED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sos_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "Message" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fromSecurity" BOOLEAN NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "entityId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("tenantId","actorId","operationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "LoginLimit_bucket_idx" ON "LoginLimit"("bucket");

-- CreateIndex
CREATE INDEX "Job_tenantId_siteId_dueAt_idx" ON "Job"("tenantId", "siteId", "dueAt");

-- CreateIndex
CREATE INDEX "Job_tenantId_guardId_dutyStart_idx" ON "Job"("tenantId", "guardId", "dutyStart");

-- CreateIndex
CREATE INDEX "Incident_tenantId_siteId_createdAt_idx" ON "Incident"("tenantId", "siteId", "createdAt");

-- CreateIndex
CREATE INDEX "Sos_tenantId_siteId_createdAt_idx" ON "Sos"("tenantId", "siteId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_tenantId_siteId_clientId_createdAt_idx" ON "Message"("tenantId", "siteId", "clientId", "createdAt");

-- CreateIndex
CREATE INDEX "Audit_tenantId_siteId_occurredAt_idx" ON "Audit"("tenantId", "siteId", "occurredAt");

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_tenantId_siteId_fkey" FOREIGN KEY ("tenantId", "siteId") REFERENCES "Site"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_tenantId_siteId_fkey" FOREIGN KEY ("tenantId", "siteId") REFERENCES "Site"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_tenantId_guardId_fkey" FOREIGN KEY ("tenantId", "guardId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Audit records are append-only for ordinary mutation paths.
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only';
END;
$$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON "Audit"
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
