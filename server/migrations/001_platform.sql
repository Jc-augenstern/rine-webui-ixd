-- IXD platform schema. The migration runner owns transactions and its ledger.
-- No accounts, passwords, development fixtures, or attendance entities belong here.

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL CHECK (char_length(username) BETWEEN 3 AND 40),
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  password_hash text NOT NULL CHECK (char_length(password_hash) BETWEEN 30 AND 512),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  role text NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'EDITOR', 'ADMIN')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  member_status text NOT NULL DEFAULT 'NONE' CHECK (member_status IN ('NONE', 'MEMBER')),
  email_verified_at timestamptz,
  grade text NOT NULL DEFAULT '' CHECK (char_length(grade) <= 40),
  major text NOT NULL DEFAULT '' CHECK (char_length(major) <= 100),
  direction_ids text[] NOT NULL DEFAULT '{}' CHECK (
    direction_ids <@ ARRAY['ai', 'robotics', 'interaction', 'visual', 'xr', 'hardware']::text[]
  ),
  profile_version integer NOT NULL DEFAULT 1 CHECK (profile_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_ci_unique ON users (lower(username));
CREATE UNIQUE INDEX users_email_ci_unique ON users (lower(email));
CREATE INDEX users_admin_status_idx ON users (role, status, id);
CREATE INDEX users_created_idx ON users (created_at DESC, id);

-- The store hashes the opaque @fastify/session ID before selecting this table.
-- data is server-only session state; roles are read from users on each request.
CREATE TABLE sessions (
  sid text PRIMARY KEY CHECK (sid ~ '^[a-f0-9]{64}$'),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE email_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('VERIFY_EMAIL', 'RESET_PASSWORD')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX email_tokens_user_purpose_idx ON email_tokens (user_id, purpose);
CREATE INDEX email_tokens_expiry_idx ON email_tokens (expires_at) WHERE consumed_at IS NULL;

CREATE TABLE contents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN (
    'announcements', 'competitions', 'projects', 'events', 'resources',
    'works', 'directions', 'learning-paths', 'pages'
  )),
  slug text NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 120),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  draft_version_id uuid,
  published_version_id uuid,
  scheduled_version_id uuid,
  publish_at timestamptz,
  published_at timestamptz,
  expires_at timestamptz,
  scheduled_expires_at timestamptz,
  scheduled_notify_important boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'DRAFT' CHECK (
    state IN ('DRAFT', 'PUBLISHED', 'WITHDRAWN', 'ARCHIVED', 'REVIEW', 'RETURNED')
  ),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  attention_revision integer NOT NULL DEFAULT 0 CHECK (attention_revision >= 0),
  review_reason text NOT NULL DEFAULT '' CHECK (char_length(review_reason) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, slug),
  CHECK ((scheduled_version_id IS NULL) = (publish_at IS NULL))
);
CREATE INDEX contents_kind_updated_idx ON contents (kind, updated_at DESC, id);
CREATE INDEX contents_owner_idx ON contents (owner_id, kind, updated_at DESC, id);
CREATE INDEX contents_state_idx ON contents (kind, state, id);
CREATE INDEX contents_scheduled_idx ON contents (publish_at, id) WHERE scheduled_version_id IS NOT NULL;

CREATE TABLE content_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_id, revision),
  UNIQUE (id, content_id)
);
-- Composite FKs prevent a version of content A becoming content B's draft/live.
ALTER TABLE contents ADD CONSTRAINT contents_draft_version_fk
  FOREIGN KEY (draft_version_id, id) REFERENCES content_versions(id, content_id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE contents ADD CONSTRAINT contents_published_version_fk
  FOREIGN KEY (published_version_id, id) REFERENCES content_versions(id, content_id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE contents ADD CONSTRAINT contents_scheduled_version_fk
  FOREIGN KEY (scheduled_version_id, id) REFERENCES content_versions(id, content_id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX content_versions_payload_idx ON content_versions USING gin (payload jsonb_path_ops);

CREATE FUNCTION reject_content_version_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Content versions are immutable; insert a new revision'
    USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER content_versions_immutable BEFORE UPDATE ON content_versions
  FOR EACH ROW EXECUTE FUNCTION reject_content_version_update();

CREATE TABLE directions (
  id text PRIMARY KEY CHECK (id IN ('ai', 'robotics', 'interaction', 'visual', 'xr', 'hardware')),
  content_id uuid NOT NULL UNIQUE REFERENCES contents(id) ON DELETE RESTRICT
);

CREATE TABLE editor_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_kind text NOT NULL CHECK (content_kind IN (
    'announcements', 'competitions', 'projects', 'events', 'resources',
    'works', 'directions', 'learning-paths', 'pages'
  )),
  direction_id text CHECK (direction_id IN ('ai', 'robotics', 'interaction', 'visual', 'xr', 'hardware')),
  content_id uuid REFERENCES contents(id) ON DELETE CASCADE,
  actions text[] NOT NULL CHECK (
    cardinality(actions) > 0 AND
    actions <@ ARRAY['create', 'read', 'update', 'publish', 'archive', 'delete', 'manage']::text[]
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (direction_id IS NULL OR content_id IS NULL)
);
CREATE UNIQUE INDEX editor_grants_scope_unique ON editor_grants
  (user_id, content_kind, coalesce(direction_id, ''), coalesce(content_id::text, ''));
CREATE INDEX editor_grants_content_idx ON editor_grants (content_id) WHERE content_id IS NOT NULL;

CREATE TABLE site_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  draft jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(draft) = 'object'),
  published jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(published) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  published_revision integer NOT NULL DEFAULT 0 CHECK (published_revision >= 0 AND published_revision <= revision),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
INSERT INTO site_settings (id) VALUES (true);

CREATE TABLE media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  storage_key text NOT NULL UNIQUE CHECK (char_length(storage_key) BETWEEN 1 AND 240),
  original_name text NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 240),
  mime_type text NOT NULL CHECK (char_length(mime_type) BETWEEN 1 AND 100),
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  access_level text NOT NULL DEFAULT 'PRIVATE' CHECK (access_level IN ('PUBLIC', 'PRIVATE')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_owner_created_idx ON media (owner_id, created_at DESC, id);
CREATE TABLE content_version_media (
  version_id uuid NOT NULL REFERENCES content_versions(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES media(id) ON DELETE RESTRICT,
  usage text NOT NULL CHECK (usage IN ('attachment', 'cover', 'inline')),
  PRIMARY KEY (version_id, media_id, usage)
);
CREATE INDEX content_version_media_media_idx ON content_version_media (media_id);

-- Exact version references protect both the live document and its draft/history.
CREATE TABLE content_version_links (
  version_id uuid NOT NULL REFERENCES content_versions(id) ON DELETE CASCADE,
  target_content_id uuid NOT NULL REFERENCES contents(id) ON DELETE RESTRICT,
  relation text NOT NULL CHECK (relation IN ('related', 'resource', 'project', 'direction')),
  PRIMARY KEY (version_id, target_content_id, relation)
);
CREATE INDEX content_version_links_target_idx ON content_version_links (target_content_id);

-- Runtime project positions are synchronized only by the publication transaction.
CREATE TABLE project_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES contents(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 3000),
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 10000),
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 10000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE (id, project_id)
);
CREATE INDEX project_positions_project_idx ON project_positions (project_id, sort_order, id);

CREATE TABLE project_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES contents(id) ON DELETE RESTRICT,
  position_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  motivation text NOT NULL CHECK (char_length(motivation) BETWEEN 10 AND 3000),
  portfolio_url text CHECK (portfolio_url IS NULL OR char_length(portfolio_url) <= 2000),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  decision_reason text NOT NULL DEFAULT '' CHECK (char_length(decision_reason) <= 2000),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id),
  UNIQUE (id, project_id, user_id),
  FOREIGN KEY (position_id, project_id) REFERENCES project_positions(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX project_applications_manager_idx ON project_applications (project_id, status, created_at, id);
CREATE INDEX project_applications_user_idx ON project_applications (user_id, updated_at DESC, id);
CREATE INDEX project_applications_position_idx ON project_applications (position_id, status);

CREATE TABLE project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES contents(id) ON DELETE RESTRICT,
  position_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  application_id uuid,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LEFT', 'REMOVED')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  UNIQUE (project_id, user_id),
  FOREIGN KEY (position_id, project_id) REFERENCES project_positions(id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (application_id, project_id, user_id)
    REFERENCES project_applications(id, project_id, user_id) ON DELETE RESTRICT,
  CHECK ((status = 'ACTIVE' AND left_at IS NULL) OR (status <> 'ACTIVE' AND left_at IS NOT NULL))
);
CREATE INDEX project_members_capacity_idx ON project_members (position_id) WHERE status = 'ACTIVE';
CREATE INDEX project_members_user_idx ON project_members (user_id, status, joined_at DESC);

CREATE TABLE event_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES contents(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'REGISTERED' CHECK (status IN ('REGISTERED', 'CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);
CREATE INDEX event_registrations_capacity_idx ON event_registrations (event_id) WHERE status = 'REGISTERED';
CREATE INDEX event_registrations_user_idx ON event_registrations (user_id, updated_at DESC, id);

CREATE TABLE competition_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES contents(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 2000),
  status text NOT NULL DEFAULT 'INTERESTED' CHECK (status IN ('INTERESTED', 'WITHDRAWN')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, user_id)
);
CREATE INDEX competition_intents_user_idx ON competition_intents (user_id, updated_at DESC, id);

CREATE TABLE favorites (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id uuid NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  reminder_hours integer[] NOT NULL DEFAULT ARRAY[24] CHECK (
    cardinality(reminder_hours) <= 3 AND reminder_hours <@ ARRAY[24, 72, 168]::integer[]
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, content_id)
);
CREATE INDEX favorites_content_idx ON favorites (content_id);
CREATE INDEX favorites_user_created_idx ON favorites (user_id, created_at DESC, content_id);

CREATE TABLE announcement_reads (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  announcement_id uuid NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  attention_revision integer NOT NULL CHECK (attention_revision >= 0),
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, announcement_id)
);
CREATE INDEX announcement_reads_announcement_idx ON announcement_reads (announcement_id);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (char_length(type) BETWEEN 1 AND 80),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 4000),
  content_id uuid REFERENCES contents(id) ON DELETE SET NULL,
  dedupe_key text NOT NULL CHECK (char_length(dedupe_key) BETWEEN 1 AND 400),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX notifications_user_created_idx ON notifications (user_id, created_at DESC, id);
CREATE INDEX notifications_unread_idx ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX notifications_content_idx ON notifications (content_id) WHERE content_id IS NOT NULL;

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 80),
  payload jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object'),
  dedupe_key text NOT NULL UNIQUE CHECK (char_length(dedupe_key) BETWEEN 1 AND 400),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'DONE', 'CANCELLED', 'FAILED')),
  run_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 100),
  locked_at timestamptz,
  locked_by text CHECK (locked_by IS NULL OR char_length(locked_by) <= 160),
  lease_expires_at timestamptz,
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 2000),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'RUNNING' OR (locked_at IS NOT NULL AND locked_by IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX jobs_pending_idx ON jobs (run_at, id) WHERE status = 'PENDING';
CREATE INDEX jobs_expired_lease_idx ON jobs (lease_expires_at, id) WHERE status = 'RUNNING';
CREATE INDEX jobs_cleanup_idx ON jobs (finished_at) WHERE status IN ('DONE', 'CANCELLED', 'FAILED');

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 100),
  resource_type text NOT NULL CHECK (char_length(resource_type) BETWEEN 1 AND 80),
  resource_id text CHECK (resource_id IS NULL OR char_length(resource_id) <= 160),
  changes jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(changes) = 'object'),
  request_id text CHECK (request_id IS NULL OR char_length(request_id) <= 160),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC, id);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC, id);
CREATE INDEX audit_logs_resource_idx ON audit_logs (resource_type, resource_id, created_at DESC, id);
