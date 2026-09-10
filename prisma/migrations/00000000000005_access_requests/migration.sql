-- Cria a fila de solicitações públicas de acesso com RLS.
-- Solicitações públicas de acesso: podem ser criadas sem sessão,
-- mas só o PLATFORM_ADMIN pode consultar, aprovar ou rejeitar.
CREATE TYPE "AccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "AccessRequest" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "companyDocument" TEXT,
    "message" TEXT,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" UUID,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccessRequest_status_createdAt_idx" ON "AccessRequest"("status", "createdAt");
CREATE INDEX "AccessRequest_email_idx" ON "AccessRequest"("email");
CREATE UNIQUE INDEX "AccessRequest_pending_email_key" ON "AccessRequest"("email") WHERE "status" = 'PENDING';

ALTER TABLE "AccessRequest"
ADD CONSTRAINT "AccessRequest_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."AccessRequest" TO bluecat_api;

ALTER TABLE public."AccessRequest" ENABLE ROW LEVEL SECURITY;

CREATE POLICY access_request_public_insert
ON public."AccessRequest"
FOR INSERT TO bluecat_api
WITH CHECK (
  "status" = 'PENDING'::public."AccessRequestStatus"
  AND "reviewedAt" IS NULL
  AND "reviewedById" IS NULL
);

CREATE POLICY access_request_platform_all
ON public."AccessRequest"
FOR ALL TO bluecat_api
USING (public.app_is_platform_admin())
WITH CHECK (public.app_is_platform_admin());
