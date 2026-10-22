ALTER TABLE files ADD COLUMN part_size INTEGER NOT NULL DEFAULT 8388608;
CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('submission','collaboration')),
  title TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  encrypted_code TEXT NOT NULL,
  connector_id TEXT NOT NULL REFERENCES connectors(id),
  source_file_id TEXT REFERENCES files(id),
  current_file_id TEXT REFERENCES files(id),
  target_name TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  max_file_bytes INTEGER NOT NULL CHECK(max_file_bytes>0),
  max_files INTEGER NOT NULL CHECK(max_files>0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX invitations_owner ON invitations(owner_id,created_at);
CREATE TABLE invitation_recipients (
  invitation_id TEXT NOT NULL REFERENCES invitations(id),
  email TEXT NOT NULL,
  PRIMARY KEY(invitation_id,email)
);
CREATE TABLE invitation_sessions (
  token_hash TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL REFERENCES invitations(id),
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE invitation_files (
  file_id TEXT PRIMARY KEY REFERENCES files(id),
  invitation_id TEXT NOT NULL REFERENCES invitations(id),
  recipient_email TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  published_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX invitation_files_link ON invitation_files(invitation_id,created_at);
