-- The PIN rows are audited under their own entity name. Adding an enum value has to
-- live in its own migration: PostgreSQL will not let a new value be used in the same
-- transaction that created it.

ALTER TYPE "AuditEntity" ADD VALUE IF NOT EXISTS 'CREDENTIAL';
