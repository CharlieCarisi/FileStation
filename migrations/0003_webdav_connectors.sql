ALTER TABLE connectors ADD COLUMN storage_adapter TEXT;
UPDATE connectors SET storage_adapter=COALESCE(adapter,kind);
