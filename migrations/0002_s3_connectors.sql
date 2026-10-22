ALTER TABLE connectors ADD COLUMN adapter TEXT CHECK(adapter IS NULL OR adapter IN ('r2','alipan','s3'));
