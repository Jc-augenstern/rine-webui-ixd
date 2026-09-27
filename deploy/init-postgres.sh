#!/bin/sh
set -eu
: "${POSTGRES_APP_PASSWORD:?Set a random application database password}"
: "${POSTGRES_APP_DB:?Set the application database name}"
psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 <<'SQL'
\getenv app_password POSTGRES_APP_PASSWORD
\getenv app_database POSTGRES_APP_DB
CREATE ROLE ixd_platform LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
SELECT format('CREATE DATABASE %I OWNER ixd_platform', :'app_database') \gexec
SQL
if [ "${IXD_CREATE_TEST_DB:-0}" = "1" ]; then
    psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 -c 'CREATE DATABASE ixd_platform_test OWNER ixd_platform;'
fi
