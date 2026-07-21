-- Portal credential vault (ATS account storage for the apply agent).
--
-- See packages/db/CREDENTIALS.md for the design rationale, and
-- packages/db/prisma/schema.prisma for the per-column notes.
--
-- `password_encrypted` is bytea holding AES-256-GCM ciphertext produced in
-- the application layer (packages/db/lib/encryption.ts). No pgcrypto, no
-- DB-side key -- consistent with every other sensitive column in this schema.

-- CreateTable
CREATE TABLE "portal_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "site_name" TEXT NOT NULL,
    "origin_hostname" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_encrypted" BYTEA NOT NULL,
    "created_by_agent" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_revealed_at" TIMESTAMP(3),

    CONSTRAINT "portal_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reveal_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "unlocked_until" TIMESTAMP(3),
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reveal_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credential_reveal_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "credential_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revealed_by" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "credential_reveal_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portal_credentials_user_id_idx" ON "portal_credentials"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "portal_credentials_user_id_domain_username_key" ON "portal_credentials"("user_id", "domain", "username");

-- CreateIndex
CREATE UNIQUE INDEX "reveal_challenges_code_hash_key" ON "reveal_challenges"("code_hash");

-- CreateIndex
CREATE INDEX "reveal_challenges_user_id_idx" ON "reveal_challenges"("user_id");

-- CreateIndex
CREATE INDEX "credential_reveal_events_user_id_idx" ON "credential_reveal_events"("user_id");

-- CreateIndex
CREATE INDEX "credential_reveal_events_credential_id_idx" ON "credential_reveal_events"("credential_id");

-- AddForeignKey
ALTER TABLE "portal_credentials" ADD CONSTRAINT "portal_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reveal_challenges" ADD CONSTRAINT "reveal_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_reveal_events" ADD CONSTRAINT "credential_reveal_events_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "portal_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_reveal_events" ADD CONSTRAINT "credential_reveal_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
