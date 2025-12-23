-- Step 08: durable `setVotes` strong idempotency (DB-backed)
CREATE TABLE "set_votes_idempotency" (
    "pubkey" BYTEA NOT NULL,
    "nonce" VARCHAR(128) NOT NULL,
    "response" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "set_votes_idempotency_pkey" PRIMARY KEY ("pubkey", "nonce"),
    CONSTRAINT "set_votes_idempotency_pubkey_len" CHECK (octet_length("pubkey") = 32),
    CONSTRAINT "set_votes_idempotency_nonce_nonempty" CHECK (char_length("nonce") > 0),
    CONSTRAINT "set_votes_idempotency_expires_after_created" CHECK ("expires_at" >= "created_at")
);

CREATE INDEX "set_votes_idempotency_expires_at_idx"
  ON "set_votes_idempotency"("expires_at");
