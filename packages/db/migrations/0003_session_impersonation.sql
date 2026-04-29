-- Track impersonation sessions explicitly instead of deriving them from user email.

ALTER TABLE sessions ADD COLUMN is_impersonation INTEGER NOT NULL DEFAULT 0;
