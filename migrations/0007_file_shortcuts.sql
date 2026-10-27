-- Shortcuts are logical references to files, never additional stored objects.
CREATE TABLE file_shortcuts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES folders(id),
  space TEXT NOT NULL DEFAULT 'private' CHECK(space IN ('private','public')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 255 AND name=trim(name) AND name NOT IN ('.','..') AND instr(name,'/')=0 AND instr(name,char(92))=0),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX shortcuts_destination ON file_shortcuts(file_id,space,CASE WHEN space='public' THEN '' ELSE owner_id END,COALESCE(folder_id,''));
CREATE INDEX shortcuts_folder ON file_shortcuts(space,owner_id,folder_id);
CREATE TRIGGER shortcuts_insert_guard BEFORE INSERT ON file_shortcuts BEGIN
  SELECT CASE WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM folders WHERE id=NEW.folder_id AND space=NEW.space AND (NEW.space='public' OR owner_id=NEW.owner_id)) THEN RAISE(ABORT,'folder_owner') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM file_shortcuts WHERE space=NEW.space AND (NEW.space='public' OR owner_id=NEW.owner_id))>=1000 THEN RAISE(ABORT,'shortcut_limit') END;
  SELECT CASE WHEN NEW.space='public' AND NOT EXISTS(SELECT 1 FROM files WHERE id=NEW.file_id AND space='public' AND state='ready' AND (expires_at IS NULL OR expires_at>CAST(strftime('%s','now') AS INTEGER)*1000)) THEN RAISE(ABORT,'shortcut_private_target') END;
END;
CREATE TRIGGER shortcuts_identity_guard BEFORE UPDATE OF owner_id,file_id ON file_shortcuts WHEN NEW.owner_id<>OLD.owner_id OR NEW.file_id<>OLD.file_id BEGIN
  SELECT RAISE(ABORT,'shortcut_identity');
END;
CREATE TRIGGER shortcuts_move_guard BEFORE UPDATE OF folder_id,space ON file_shortcuts BEGIN
  SELECT CASE WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM folders WHERE id=NEW.folder_id AND space=NEW.space AND (NEW.space='public' OR owner_id=NEW.owner_id)) THEN RAISE(ABORT,'folder_owner') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM file_shortcuts WHERE id<>OLD.id AND space=NEW.space AND (NEW.space='public' OR owner_id=NEW.owner_id))>=1000 THEN RAISE(ABORT,'shortcut_limit') END;
  SELECT CASE WHEN NEW.space='public' AND OLD.space<>'public' AND NOT EXISTS(SELECT 1 FROM files WHERE id=NEW.file_id AND space='public' AND state='ready' AND (expires_at IS NULL OR expires_at>CAST(strftime('%s','now') AS INTEGER)*1000)) THEN RAISE(ABORT,'shortcut_private_target') END;
END;
CREATE TRIGGER folders_shortcut_guard BEFORE DELETE ON folders WHEN EXISTS(SELECT 1 FROM file_shortcuts WHERE folder_id=OLD.id) BEGIN
  SELECT RAISE(ABORT,'folder_shortcuts');
END;
