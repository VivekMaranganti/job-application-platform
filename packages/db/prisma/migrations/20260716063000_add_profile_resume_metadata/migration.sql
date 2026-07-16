-- AlterTable
-- Not sensitive (unlike resume_file_url_encrypted) -- plain columns so the
-- UI can render the uploaded file's name/size without decrypting or
-- fetching the file itself. Added when wiring the Postgres-backed
-- Repository (apps/web/lib/repository/postgres.ts).
ALTER TABLE "profiles"
    ADD COLUMN "resume_file_name" TEXT,
    ADD COLUMN "resume_file_size" INTEGER,
    ADD COLUMN "resume_mime_type" TEXT;
