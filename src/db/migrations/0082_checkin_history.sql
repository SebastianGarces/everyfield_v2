ALTER TABLE planter_checkins ADD COLUMN edit_history jsonb NOT NULL DEFAULT '[]'::jsonb;
