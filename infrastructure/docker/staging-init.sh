#!/bin/sh
set -eu
case "$DINNER_STAGING_RUNTIME_PASSWORD" in
  *[!A-Za-z0-9_-]*|'') printf 'Invalid staging runtime password format\n' >&2; exit 1 ;;
esac
[ "${#DINNER_STAGING_RUNTIME_PASSWORD}" -ge 32 ]
# This runs only while initializing the separate staging PostgreSQL volume.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE dinner_swipe_staging_runtime LOGIN PASSWORD '${DINNER_STAGING_RUNTIME_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
REVOKE CREATE, TEMP ON DATABASE dinner_swipe_staging FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE dinner_swipe_staging TO dinner_swipe_staging_runtime;
GRANT USAGE ON SCHEMA public TO dinner_swipe_staging_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE dinner_swipe_staging_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dinner_swipe_staging_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE dinner_swipe_staging_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO dinner_swipe_staging_runtime;
SQL
