-- Existing files, folders and invitations remain personal/private.
ALTER TABLE folders ADD COLUMN space TEXT NOT NULL DEFAULT 'private' CHECK(space IN ('private','public'));
ALTER TABLE files ADD COLUMN space TEXT NOT NULL DEFAULT 'private' CHECK(space IN ('private','public'));
ALTER TABLE invitations ADD COLUMN space TEXT NOT NULL DEFAULT 'private' CHECK(space IN ('private','public'));
DROP INDEX folders_sibling_name;
CREATE UNIQUE INDEX folders_sibling_name ON folders(space,CASE WHEN space='public' THEN '' ELSE owner_id END,COALESCE(parent_id,''),name COLLATE NOCASE);
CREATE INDEX folders_space_parent ON folders(space,parent_id);
CREATE INDEX files_space_folder ON files(space,folder_id,state,created_at);
DROP TRIGGER folders_insert_guard;
DROP TRIGGER folders_move_guard;
DROP TRIGGER files_folder_insert;
DROP TRIGGER files_folder_update;
DROP TRIGGER invitations_folder_insert;
DROP TRIGGER invitations_folder_update;
CREATE TRIGGER folders_space_immutable BEFORE UPDATE OF space ON folders WHEN NEW.space<>OLD.space BEGIN
  SELECT RAISE(ABORT,'folder_space');
END;
CREATE TRIGGER folders_insert_guard BEFORE INSERT ON folders BEGIN
  SELECT CASE WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM folders WHERE id=NEW.parent_id AND space=NEW.space AND (NEW.space='public' OR owner_id=NEW.owner_id)) THEN RAISE(ABORT,'folder_owner') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM folders WHERE space=NEW.space AND (NEW.space='public' OR owner_id=NEW.owner_id))>=1000 THEN RAISE(ABORT,'folder_limit') END;
  SELECT CASE WHEN (WITH RECURSIVE ancestors(id,parent_id,depth) AS (
    SELECT id,parent_id,1 FROM folders WHERE id=NEW.parent_id
    UNION ALL SELECT f.id,f.parent_id,a.depth+1 FROM folders f JOIN ancestors a ON f.id=a.parent_id WHERE a.depth<=20
  ) SELECT COALESCE(MAX(depth),0)+1 FROM ancestors)>20 THEN RAISE(ABORT,'folder_depth') END;
END;
CREATE TRIGGER folders_move_guard BEFORE UPDATE OF parent_id ON folders WHEN NEW.parent_id IS NOT OLD.parent_id BEGIN
  SELECT CASE WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM folders WHERE id=NEW.parent_id AND space=NEW.space AND (NEW.space='public' OR owner_id=NEW.owner_id)) THEN RAISE(ABORT,'folder_owner') END;
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
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM folders WHERE id=NEW.folder_id AND space=NEW.space AND (NEW.space='public' OR owner_id=NEW.owner_id)) THEN RAISE(ABORT,'folder_owner') END;
END;
CREATE TRIGGER files_folder_update BEFORE UPDATE OF folder_id,owner_id,space ON files WHEN NEW.folder_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM folders WHERE id=NEW.folder_id AND space=NEW.space AND (NEW.space='public' OR owner_id=NEW.owner_id)) THEN RAISE(ABORT,'folder_owner') END;
END;
CREATE TRIGGER invitations_folder_insert BEFORE INSERT ON invitations WHEN NEW.folder_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM folders WHERE id=NEW.folder_id AND space=NEW.space AND (NEW.space='public' OR owner_id=NEW.owner_id)) THEN RAISE(ABORT,'folder_owner') END;
END;
CREATE TRIGGER invitations_folder_update BEFORE UPDATE OF folder_id,owner_id,space ON invitations WHEN NEW.folder_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM folders WHERE id=NEW.folder_id AND space=NEW.space AND (NEW.space='public' OR owner_id=NEW.owner_id)) THEN RAISE(ABORT,'folder_owner') END;
END;
