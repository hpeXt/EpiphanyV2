-- Cleanup accidental test topics from a development database.
--
-- Default behavior is DRY RUN (prints what would be deleted).
-- To APPLY deletions, pass `-v APPLY=1`.
--
-- Example (dry run):
--   docker compose exec -T postgres psql -U postgres -d epiphany -v ON_ERROR_STOP=1 -f - < scripts/db/cleanup-test-topics.sql
--
-- Example (apply):
--   docker compose exec -T postgres psql -U postgres -d epiphany -v ON_ERROR_STOP=1 -v APPLY=1 -f - < scripts/db/cleanup-test-topics.sql
--
-- What it deletes:
--   - topics where title ILIKE 'Test%'
--   - their dependent rows (stakes/cluster_data/.../arguments), in FK-safe order
--
\set ON_ERROR_STOP on

\if :{?APPLY}
\echo 'APPLY=1 (will DELETE)'
\else
\echo 'DRY RUN (set -v APPLY=1 to delete)'
\endif

-- Preview
SELECT
  COUNT(*) FILTER (WHERE title ILIKE 'Test%') AS test_topics,
  COUNT(*) AS total_topics
FROM topics;

SELECT id, title, created_at
FROM topics
WHERE title ILIKE 'Test%'
ORDER BY created_at ASC, id ASC
LIMIT 200;

\if :{?APPLY}
DO $$
DECLARE
  topic_row RECORD;
  deleted_rows INTEGER;
BEGIN
  FOR topic_row IN
    SELECT id
    FROM topics
    WHERE title ILIKE 'Test%'
    ORDER BY created_at ASC, id ASC
  LOOP
    -- Break the Topic->rootArgument FK so we can delete the tree.
    UPDATE topics SET root_argument_id = NULL WHERE id = topic_row.id;

    -- Delete dependent tables first (FKs are mostly RESTRICT).
    DELETE FROM stakes WHERE topic_id = topic_row.id;
    DELETE FROM cluster_data WHERE topic_id = topic_row.id;
    DELETE FROM camps WHERE topic_id = topic_row.id;
    DELETE FROM consensus_reports WHERE topic_id = topic_row.id;
    DELETE FROM topic_pubkey_blacklist WHERE topic_id = topic_row.id;
    DELETE FROM topic_identity_profiles WHERE topic_id = topic_row.id;
    DELETE FROM ledgers WHERE topic_id = topic_row.id;

    -- Delete arguments bottom-up (parent_id FK is RESTRICT and not DEFERRABLE).
    LOOP
      DELETE FROM arguments a
      WHERE a.topic_id = topic_row.id
        AND NOT EXISTS (
          SELECT 1
          FROM arguments c
          WHERE c.topic_id = a.topic_id
            AND c.parent_id = a.id
        );
      GET DIAGNOSTICS deleted_rows = ROW_COUNT;
      EXIT WHEN deleted_rows = 0;
    END LOOP;

    -- Finally delete the topic itself.
    DELETE FROM topics WHERE id = topic_row.id;
  END LOOP;
END $$;
\endif
