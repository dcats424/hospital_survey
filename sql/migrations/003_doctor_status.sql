DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'doctors' AND column_name = 'status'
  ) THEN
    ALTER TABLE doctors ADD COLUMN status TEXT DEFAULT 'active';
    UPDATE doctors SET status = 'active' WHERE is_active = TRUE;
    UPDATE doctors SET status = 'left' WHERE is_active = FALSE;
    ALTER TABLE doctors DROP COLUMN is_active;
  END IF;
END $$;
