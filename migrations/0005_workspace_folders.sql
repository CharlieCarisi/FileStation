CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  parent_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120 AND name=trim(name) AND name NOT IN ('.','..') AND instr(name,'/')=0 AND instr(name,char(92))=0),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX folders_sibling_name ON folders(owner_id,COALESCE(parent_id,''),name COLLATE NOCASE);
CREATE INDEX folders_parent ON folders(owner_id,parent_id);
ALTER TABLE files ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
ALTER TABLE invitations ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
CREATE INDEX files_folder ON files(owner_id,folder_id,state,created_at);
CREATE INDEX invitations_folder ON invitations(folder_id,revoked_at,expires_at);

CREATE TRIGGER folders_insert_guard BEFORE INSERT ON folders BEGIN
  SELECT CASE WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM folders WHERE id=NEW.parent_id AND owner_id=NEW.owner_id) THEN RAISE(ABORT,'folder_owner') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM folders WHERE owner_id=NEW.owner_id)>=1000 THEN RAISE(ABORT,'folder_limit') END;
  SELECT CASE WHEN (WITH RECURSIVE ancestors(id,parent_id,depth) AS (
    SELECT id,parent_id,1 FROM folders WHERE id=NEW.parent_id
    UNION ALL SELECT f.id,f.parent_id,a.depth+1 FROM folders f JOIN ancestors a ON f.id=a.parent_id WHERE a.depth<=20
  ) SELECT COALESCE(MAX(depth),0)+1 FROM ancestors)>20 THEN RAISE(ABORT,'folder_depth') END;
END;
CREATE TRIGGER folders_owner_immutable BEFORE UPDATE OF owner_id ON folders WHEN NEW.owner_id<>OLD.owner_id BEGIN
  SELECT RAISE(ABORT,'folder_owner');
END;
CREATE TRIGGER folders_move_guard BEFORE UPDATE OF parent_id ON folders WHEN NEW.parent_id IS NOT OLD.parent_id BEGIN
  SELECT CASE WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM folders WHERE id=NEW.parent_id AND owner_id=NEW.owner_id) THEN RAISE(ABORT,'folder_owner') END;
  SELECT CASE WHEN NEW.parent_id=NEW.id OR EXISTS(
    WITH RECURSIVE descendants(id) AS (SELECT OLD.id UNION ALL SELECT f.id FROM folders f JOIN descendants d ON f.parent_id=d.id)
    SELECT 1 FROM descendants WHERE id=NEW.parent_id
  ) THEN RAISE(ABORT,'folder_cycle') END;
  SELECT CASE WHEN (WITH RECURSIVE ancestors(id,parent_id,depth) AS (
    SELECT id,parent_id,1 FROM folders WHERE id=NEW.parent_id
    UNION ALL SELECT f.id,f.parent_id,a.depth+1 FROM folders f JOIN ancestors a ON f.id=a.parent_id WHERE a.depth<=20
  ), descendants(id,depth) AS (
    SELECT OLD.id,1 UNION ALL SELECT f.id,d.depth+1 FROM folders f JOIN descendants d ON f.parent_id=d.id WHERE d.depth<=20
  ) SELECT COALESCE((SELECT MAX(depth) FROM ancestors),0)+(SELECT MAX(depth) FROM descendants))>20 THEN RAISE(ABORT,'folder_depth') END;
END;
CREATE TRIGGER files_folder_insert BEFORE INSERT ON files WHEN NEW.folder_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM folders WHERE id=NEW.folder_id AND owner_id=NEW.owner_id) THEN RAISE(ABORT,'folder_owner') END;
END;
CREATE TRIGGER files_folder_update BEFORE UPDATE OF folder_id,owner_id ON files WHEN NEW.folder_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM folders WHERE id=NEW.folder_id AND owner_id=NEW.owner_id) THEN RAISE(ABORT,'folder_owner') END;
END;
CREATE TRIGGER invitations_folder_insert BEFORE INSERT ON invitations WHEN NEW.folder_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM folders WHERE id=NEW.folder_id AND owner_id=NEW.owner_id) THEN RAISE(ABORT,'folder_owner') END;
END;
CREATE TRIGGER invitations_folder_update BEFORE UPDATE OF folder_id,owner_id ON invitations WHEN NEW.folder_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM folders WHERE id=NEW.folder_id AND owner_id=NEW.owner_id) THEN RAISE(ABORT,'folder_owner') END;
END;
CREATE TRIGGER folders_delete_guard BEFORE DELETE ON folders BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM folders WHERE parent_id=OLD.id)
    OR EXISTS(SELECT 1 FROM files WHERE folder_id=OLD.id AND state<>'deleted')
    OR EXISTS(SELECT 1 FROM invitations i JOIN users u ON u.id=i.owner_id WHERE i.folder_id=OLD.id AND i.revoked_at IS NULL AND i.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000 AND u.status='active')
  THEN RAISE(ABORT,'folder_not_empty') END;
END;
