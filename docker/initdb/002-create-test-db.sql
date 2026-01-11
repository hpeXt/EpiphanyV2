-- Create an isolated database for automated tests (e2e) and ensure pgvector is available.
-- This runs only on first init of the Postgres volume (docker-entrypoint-initdb.d).

SELECT 'CREATE DATABASE epiphany_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'epiphany_test')\gexec

\connect epiphany_test
CREATE EXTENSION IF NOT EXISTS vector;
\connect epiphany

