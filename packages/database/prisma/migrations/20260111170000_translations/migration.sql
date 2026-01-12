-- Stage 04: Generic translations table for multi-locale content (zh/en)

CREATE TYPE "translation_status" AS ENUM ('pending', 'ready', 'failed', 'skipped_budget');

CREATE TYPE "translation_resource_type" AS ENUM (
    'topic_title',
    'argument',
    'consensus_report',
    'camp',
    'topic_profile_display_name'
);

CREATE TABLE "translations" (
    "id" UUID NOT NULL,
    "resource_type" "translation_resource_type" NOT NULL,
    "resource_id" TEXT NOT NULL,
    "target_locale" TEXT NOT NULL,
    "status" "translation_status" NOT NULL DEFAULT 'pending',
    "source_locale" TEXT,
    "source_hash" BYTEA,
    "data" JSONB,
    "model" TEXT,
    "provider" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "translations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "translations_source_hash_len" CHECK ("source_hash" IS NULL OR octet_length("source_hash") = 32),
    CONSTRAINT "translations_unique" UNIQUE ("resource_type", "resource_id", "target_locale")
);

CREATE INDEX "translations_target_locale_status_idx" ON "translations" ("target_locale", "status");

