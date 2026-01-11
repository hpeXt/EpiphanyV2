-- Stage 03: Topic identity profiles (topic-scoped display name per pubkey)

CREATE TABLE "topic_identity_profiles" (
    "topic_id" UUID NOT NULL,
    "pubkey" BYTEA NOT NULL,
    "display_name" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "topic_identity_profiles_pkey" PRIMARY KEY ("topic_id", "pubkey"),
    CONSTRAINT "topic_identity_profiles_pubkey_len" CHECK (octet_length("pubkey") = 32),
    CONSTRAINT "topic_identity_profiles_display_name_len" CHECK ("display_name" IS NULL OR char_length("display_name") <= 40),
    CONSTRAINT "topic_identity_profiles_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

