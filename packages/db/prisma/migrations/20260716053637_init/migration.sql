-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ProfileLevel" AS ENUM ('Entry level', 'Mid level', 'Senior', 'Staff / Principal', 'Manager', 'Director', 'Executive / VP');

-- CreateEnum
CREATE TYPE "WorkArrangement" AS ENUM ('Remote', 'Hybrid', 'Onsite');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('Full-time', 'Part-time', 'Contract', 'Internship');

-- CreateEnum
CREATE TYPE "CompanySize" AS ENUM ('Startup (1-50)', 'Small-mid (51-500)', 'Large (501-5,000)', 'Enterprise (5,000+)');

-- CreateEnum
CREATE TYPE "DatePosted" AS ENUM ('Any time', 'Past 24 hours', 'Past week', 'Past month');

-- CreateEnum
CREATE TYPE "AnswerMode" AS ENUM ('auto', 'manual');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('matched', 'reviewing', 'in_progress', 'needs_input', 'ready_for_review', 'submitted', 'skipped', 'failed');

-- CreateEnum
CREATE TYPE "LogEntrySource" AS ENUM ('auto', 'user-provided-live');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "user_id" UUID NOT NULL,
    "resume_file_url_encrypted" BYTEA,
    "resume_uploaded_at" TIMESTAMP(3),
    "locations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "levels" "ProfileLevel"[] DEFAULT ARRAY[]::"ProfileLevel"[],
    "target_titles" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "filters" (
    "user_id" UUID NOT NULL,
    "work_arrangement" "WorkArrangement"[] DEFAULT ARRAY[]::"WorkArrangement"[],
    "employment_type" "EmploymentType"[] DEFAULT ARRAY[]::"EmploymentType"[],
    "company_size" "CompanySize"[] DEFAULT ARRAY[]::"CompanySize"[],
    "salary_min" INTEGER,
    "date_posted" "DatePosted" NOT NULL DEFAULT 'Any time',
    "industries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exclude_companies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "special_instructions" TEXT,

    CONSTRAINT "filters_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "required_info_answers" (
    "user_id" UUID NOT NULL,
    "field_id" TEXT NOT NULL,
    "mode" "AnswerMode" NOT NULL DEFAULT 'manual',
    "value_encrypted" BYTEA,

    CONSTRAINT "required_info_answers_pkey" PRIMARY KEY ("user_id","field_id")
);

-- CreateTable
CREATE TABLE "job_listings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_connector" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT,
    "remote_type" TEXT,
    "employment_type" TEXT,
    "level" TEXT,
    "salary_min" INTEGER,
    "salary_max" INTEGER,
    "company_size" TEXT,
    "industry" TEXT,
    "date_posted" TIMESTAMP(3),
    "url" TEXT NOT NULL,
    "raw_payload" JSONB NOT NULL,

    CONSTRAINT "job_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "job_listing_id" UUID NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'matched',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_log_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "field_label" TEXT NOT NULL,
    "value_category" TEXT NOT NULL,
    "sent_to" TEXT NOT NULL,
    "source" "LogEntrySource" NOT NULL,

    CONSTRAINT "application_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "job_listings_source_connector_idx" ON "job_listings"("source_connector");

-- CreateIndex
CREATE INDEX "job_listings_date_posted_idx" ON "job_listings"("date_posted");

-- CreateIndex
CREATE UNIQUE INDEX "job_listings_source_connector_external_id_key" ON "job_listings"("source_connector", "external_id");

-- CreateIndex
CREATE INDEX "applications_user_id_idx" ON "applications"("user_id");

-- CreateIndex
CREATE INDEX "applications_job_listing_id_idx" ON "applications"("job_listing_id");

-- CreateIndex
CREATE INDEX "applications_status_idx" ON "applications"("status");

-- CreateIndex
CREATE UNIQUE INDEX "applications_user_id_job_listing_id_key" ON "applications"("user_id", "job_listing_id");

-- CreateIndex
CREATE INDEX "application_log_entries_user_id_idx" ON "application_log_entries"("user_id");

-- CreateIndex
CREATE INDEX "application_log_entries_application_id_idx" ON "application_log_entries"("application_id");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filters" ADD CONSTRAINT "filters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "required_info_answers" ADD CONSTRAINT "required_info_answers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_listing_id_fkey" FOREIGN KEY ("job_listing_id") REFERENCES "job_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_log_entries" ADD CONSTRAINT "application_log_entries_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_log_entries" ADD CONSTRAINT "application_log_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-added, beyond what `prisma migrate diff` generates from the schema:
-- ---------------------------------------------------------------------------

-- Defense in depth: application_log_entries.value_category must be a short,
-- coarse category label (e.g. "work_authorization", "veteran_status"), never
-- a raw field value. There is no column on this table capable of holding a
-- raw value at all -- that's the primary guarantee. This length check is a
-- soft guardrail on top of it: it cannot prove a value isn't sensitive, but
-- raw free-text answers (addresses, explanations, SSNs, etc.) are very
-- unlikely to fit in 100 characters, so it catches obvious misuse early.
ALTER TABLE "application_log_entries"
    ADD CONSTRAINT "application_log_entries_value_category_length_chk"
    CHECK (char_length("value_category") <= 100);

-- Documentation comments: make the encryption boundary discoverable straight
-- from psql / any DB introspection tool, not just from schema.prisma.
COMMENT ON COLUMN "profiles"."resume_file_url_encrypted" IS
    'Ciphertext only (AES-256-GCM, application layer -- see lib/encryption.ts). Never store the plaintext S3 URL here or in any other column.';

COMMENT ON COLUMN "required_info_answers"."value_encrypted" IS
    'Ciphertext only (AES-256-GCM, application layer -- see lib/encryption.ts). Only meaningful when mode = auto. Never store plaintext.';

COMMENT ON COLUMN "application_log_entries"."value_category" IS
    'Coarse category label only (e.g. work_authorization, veteran_status) -- never the raw submitted value. This table has no column for raw values by design.';

COMMENT ON COLUMN "job_listings"."raw_payload" IS
    'Original, unmodified connector response, kept for debugging/re-normalization when normalized columns are wrong or the source vocabulary drifts.';
