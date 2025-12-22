-- Step 23: topic-local pubkey blacklist (host-managed)
CREATE TABLE "topic_pubkey_blacklist" (
    "topic_id" UUID NOT NULL,
    "pubkey" BYTEA NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "topic_pubkey_blacklist_pkey" PRIMARY KEY ("topic_id", "pubkey"),
    CONSTRAINT "topic_pubkey_blacklist_pubkey_len" CHECK (octet_length("pubkey") = 32)
);

ALTER TABLE "topic_pubkey_blacklist"
    ADD CONSTRAINT "topic_pubkey_blacklist_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

