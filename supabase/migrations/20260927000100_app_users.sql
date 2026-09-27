-- Sign-in by username and password instead of a bare PIN.
--
-- One account per role: "admin" opens the counter screens plus the books, "user" opens
-- the counter screens. The settings screen changes the password of a role, so the role
-- stays unique here. Passwords are bcrypt hashes (cost 12), checked only by the API.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE "app_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "username" VARCHAR(40) NOT NULL,
    "role" "PinRole" NOT NULL,
    "password_hash" TEXT NOT NULL,
    -- Bumped on every password change; embedded in session tokens so old sessions die.
    "pin_version" INTEGER NOT NULL DEFAULT 1,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_users_pkey" PRIMARY KEY ("id"),
    -- Stored lower-case; the API lower-cases what is typed.
    CONSTRAINT "app_users_username_shape" CHECK ("username" ~ '^[a-z0-9._-]{3,40}$')
);
CREATE UNIQUE INDEX "app_users_username_key" ON "app_users" ("username");
CREATE UNIQUE INDEX "app_users_role_key" ON "app_users" ("role");

ALTER TABLE "app_users" ENABLE ROW LEVEL SECURITY;

-- First sign-in: admin / 9999 and user / 1234. Change both from Admin → සැකසුම් straight away.
INSERT INTO "app_users" ("username", "role", "password_hash") VALUES
  ('admin', 'ADMIN', extensions.crypt('9999', extensions.gen_salt('bf', 12))),
  ('user',  'USER',  extensions.crypt('1234', extensions.gen_salt('bf', 12)))
ON CONFLICT DO NOTHING;

-- The PIN-per-role table is replaced by the accounts above.
DROP TABLE IF EXISTS "credentials";
