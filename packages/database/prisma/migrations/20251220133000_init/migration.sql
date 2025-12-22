-- Ensure pgvector is available for `vector(4096)` columns.
CREATE EXTENSION IF NOT EXISTS "vector";

-- Enums
CREATE TYPE "topic_status" AS ENUM ('active', 'frozen', 'archived');
CREATE TYPE "argument_analysis_status" AS ENUM ('pending_analysis', 'ready', 'failed');
CREATE TYPE "report_status" AS ENUM ('generating', 'ready', 'failed');

-- Tables
CREATE TABLE "topics" (
    "id" UUID NOT NULL,
    "root_argument_id" UUID,
    "title" TEXT NOT NULL,
    "owner_pubkey" BYTEA,
    "status" "topic_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "last_clustered_at" TIMESTAMPTZ,
    "last_cluster_argument_count" INTEGER NOT NULL DEFAULT 0,
    "last_cluster_total_votes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "topics_owner_pubkey_len" CHECK ("owner_pubkey" IS NULL OR octet_length("owner_pubkey") = 32)
);

CREATE TABLE "arguments" (
    "id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "parent_id" UUID,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "author_pubkey" BYTEA NOT NULL,
    "analysis_status" "argument_analysis_status" NOT NULL DEFAULT 'pending_analysis',
    "stance_score" DOUBLE PRECISION,
    "embedding" vector(4096),
    "embedding_model" TEXT,
    "metadata" JSONB,
    "total_votes" INTEGER NOT NULL DEFAULT 0,
    "total_cost" INTEGER NOT NULL DEFAULT 0,
    "pruned_at" TIMESTAMPTZ,
    "prune_reason" TEXT,
    "pruned_by_pubkey" BYTEA,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "arguments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "arguments_author_pubkey_len" CHECK (octet_length("author_pubkey") = 32),
    CONSTRAINT "arguments_pruned_by_pubkey_len" CHECK ("pruned_by_pubkey" IS NULL OR octet_length("pruned_by_pubkey") = 32),
    CONSTRAINT "arguments_stance_score_range" CHECK ("stance_score" IS NULL OR ("stance_score" >= -1 AND "stance_score" <= 1)),
    CONSTRAINT "arguments_total_votes_nonneg" CHECK ("total_votes" >= 0),
    CONSTRAINT "arguments_total_cost_nonneg" CHECK ("total_cost" >= 0)
);

ALTER TABLE "arguments"
    ADD CONSTRAINT "arguments_topic_id_id_key" UNIQUE ("topic_id", "id");

ALTER TABLE "arguments"
    ADD CONSTRAINT "arguments_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Parent must be within the same topic.
ALTER TABLE "arguments"
    ADD CONSTRAINT "arguments_parent_same_topic_fkey" FOREIGN KEY ("topic_id", "parent_id") REFERENCES "arguments"("topic_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exactly one root per topic (parent_id IS NULL).
CREATE UNIQUE INDEX "arguments_one_root_per_topic" ON "arguments"("topic_id") WHERE "parent_id" IS NULL;

-- Topics.root_argument_id must reference an argument in the same topic.
ALTER TABLE "topics"
    ADD CONSTRAINT "topics_root_argument_id_fkey" FOREIGN KEY ("id", "root_argument_id") REFERENCES "arguments"("topic_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ledgers" (
    "topic_id" UUID NOT NULL,
    "pubkey" BYTEA NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 100,
    "total_votes_staked" INTEGER NOT NULL DEFAULT 0,
    "total_cost_staked" INTEGER NOT NULL DEFAULT 0,
    "last_interaction_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "ledgers_pkey" PRIMARY KEY ("topic_id", "pubkey"),
    CONSTRAINT "ledgers_pubkey_len" CHECK (octet_length("pubkey") = 32),
    CONSTRAINT "ledgers_balance_range" CHECK ("balance" BETWEEN 0 AND 100),
    CONSTRAINT "ledgers_total_votes_staked_nonneg" CHECK ("total_votes_staked" >= 0),
    CONSTRAINT "ledgers_total_cost_staked_range" CHECK ("total_cost_staked" BETWEEN 0 AND 100),
    CONSTRAINT "ledgers_balance_total_cost_invariant" CHECK ("balance" + "total_cost_staked" = 100)
);

ALTER TABLE "ledgers"
    ADD CONSTRAINT "ledgers_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "stakes" (
    "topic_id" UUID NOT NULL,
    "argument_id" UUID NOT NULL,
    "voter_pubkey" BYTEA NOT NULL,
    "votes" INTEGER NOT NULL,
    "cost" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "stakes_pkey" PRIMARY KEY ("topic_id", "argument_id", "voter_pubkey"),
    CONSTRAINT "stakes_voter_pubkey_len" CHECK (octet_length("voter_pubkey") = 32),
    CONSTRAINT "stakes_votes_range" CHECK ("votes" BETWEEN 1 AND 10),
    CONSTRAINT "stakes_cost_votes_square" CHECK ("cost" = "votes" * "votes")
);

ALTER TABLE "stakes"
    ADD CONSTRAINT "stakes_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Stake must reference an argument in the same topic.
ALTER TABLE "stakes"
    ADD CONSTRAINT "stakes_argument_same_topic_fkey" FOREIGN KEY ("topic_id", "argument_id") REFERENCES "arguments"("topic_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Stake must reference an existing ledger identity within the same topic.
ALTER TABLE "stakes"
    ADD CONSTRAINT "stakes_ledger_fkey" FOREIGN KEY ("topic_id", "voter_pubkey") REFERENCES "ledgers"("topic_id", "pubkey") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "camps" (
    "topic_id" UUID NOT NULL,
    "cluster_id" INTEGER NOT NULL,
    "label" TEXT,
    "summary" TEXT,
    "params" JSONB,
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "camps_pkey" PRIMARY KEY ("topic_id", "cluster_id"),
    CONSTRAINT "camps_cluster_id_nonneg" CHECK ("cluster_id" >= 0)
);

ALTER TABLE "camps"
    ADD CONSTRAINT "camps_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "cluster_data" (
    "topic_id" UUID NOT NULL,
    "argument_id" UUID NOT NULL,
    "cluster_id" INTEGER,
    "umap_x" DOUBLE PRECISION NOT NULL,
    "umap_y" DOUBLE PRECISION NOT NULL,
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "cluster_data_pkey" PRIMARY KEY ("topic_id", "argument_id"),
    CONSTRAINT "cluster_data_cluster_id_nonneg" CHECK ("cluster_id" IS NULL OR "cluster_id" >= 0)
);

ALTER TABLE "cluster_data"
    ADD CONSTRAINT "cluster_data_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cluster_data"
    ADD CONSTRAINT "cluster_data_argument_same_topic_fkey" FOREIGN KEY ("topic_id", "argument_id") REFERENCES "arguments"("topic_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cluster_data"
    ADD CONSTRAINT "cluster_data_camp_fkey" FOREIGN KEY ("topic_id", "cluster_id") REFERENCES "camps"("topic_id", "cluster_id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "consensus_reports" (
    "id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "status" "report_status" NOT NULL DEFAULT 'generating',
    "content_md" TEXT,
    "model" TEXT,
    "prompt_version" TEXT,
    "computed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "consensus_reports_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "consensus_reports"
    ADD CONSTRAINT "consensus_reports_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Indexes (MVP)
CREATE INDEX "topics_created_at_idx" ON "topics"("created_at");
CREATE INDEX "topics_status_idx" ON "topics"("status");

CREATE INDEX "arguments_analysis_status_idx" ON "arguments"("analysis_status");
CREATE INDEX "arguments_topic_parent_idx" ON "arguments"("topic_id", "parent_id");
CREATE INDEX "arguments_topic_pruned_at_idx" ON "arguments"("topic_id", "pruned_at");

-- Read-path indexes (docs/stage01/database.md §5)
CREATE INDEX "arguments_children_hot_idx" ON "arguments"("topic_id", "parent_id", "total_votes" DESC);
CREATE INDEX "arguments_children_new_idx" ON "arguments"("topic_id", "parent_id", "created_at" DESC, "id" DESC);

CREATE INDEX "ledgers_last_interaction_at_idx" ON "ledgers"("topic_id", "last_interaction_at");
CREATE INDEX "stakes_topic_voter_pubkey_idx" ON "stakes"("topic_id", "voter_pubkey");

CREATE INDEX "camps_computed_at_idx" ON "camps"("topic_id", "computed_at");
CREATE INDEX "cluster_data_computed_at_idx" ON "cluster_data"("topic_id", "computed_at");

CREATE INDEX "consensus_reports_topic_id_idx" ON "consensus_reports"("topic_id");
CREATE INDEX "consensus_reports_status_idx" ON "consensus_reports"("status");
CREATE INDEX "consensus_reports_computed_at_idx" ON "consensus_reports"("topic_id", "computed_at");

