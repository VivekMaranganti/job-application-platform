-- AlterTable
-- Contact fields for the apply agent (full name, phone, contact email,
-- LinkedIn/portfolio links). Not sensitive in the same way
-- required_info_answers.value_encrypted is -- plain columns, same treatment
-- as resume_file_name/resume_file_size in the prior migration.
-- contact_email is distinct from users.email (used for magic-link auth);
-- the application layer falls back to users.email when this is null.
ALTER TABLE "profiles"
    ADD COLUMN "full_name" TEXT,
    ADD COLUMN "phone" TEXT,
    ADD COLUMN "contact_email" TEXT,
    ADD COLUMN "linkedin_url" TEXT,
    ADD COLUMN "portfolio_url" TEXT;
