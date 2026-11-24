ALTER TABLE shares ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'recipients'
  CHECK (access_mode IN ('recipients', 'anyone'));
ALTER TABLE shares ADD COLUMN encrypted_link_token TEXT;
