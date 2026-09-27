-- Bind sessions to a monotonically increasing access generation. Revocation also
-- invalidates a login that began before a concurrent password/access change.
ALTER TABLE users ADD COLUMN auth_version integer NOT NULL DEFAULT 1 CHECK (auth_version > 0);
