DO $$
DECLARE
  cons_name text;
  key_exists boolean;
BEGIN
  FOR cons_name IN
    SELECT con.conname
    FROM pg_catalog.pg_constraint con
    WHERE con.conrelid = 'admin_sessions'::regclass
      AND con.conname LIKE 'admin_sessions_token_hash_key%'
  LOOP
    EXECUTE format('ALTER TABLE admin_sessions DROP CONSTRAINT %I', cons_name);
  END LOOP;

  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint con
    WHERE con.conrelid = 'admin_sessions'::regclass
      AND con.conname = 'admin_sessions_token_hash_key'
  ) INTO key_exists;

  IF NOT key_exists THEN
    EXECUTE 'ALTER TABLE admin_sessions ADD CONSTRAINT admin_sessions_token_hash_key UNIQUE (token_hash)';
  END IF;
END $$;
