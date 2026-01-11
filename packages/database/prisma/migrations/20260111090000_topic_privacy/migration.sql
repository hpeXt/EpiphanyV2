-- Stage 03: Topic privacy (public/unlisted/private) + access key hash

CREATE TYPE "topic_visibility" AS ENUM ('public', 'unlisted', 'private');

ALTER TABLE "topics"
    ADD COLUMN "visibility" "topic_visibility" NOT NULL DEFAULT 'public',
    ADD COLUMN "access_key_hash" BYTEA,
    ADD COLUMN "access_key_rotated_at" TIMESTAMPTZ;

ALTER TABLE "topics"
    ADD CONSTRAINT "topics_access_key_hash_len"
    CHECK ("access_key_hash" IS NULL OR octet_length("access_key_hash") = 32);

