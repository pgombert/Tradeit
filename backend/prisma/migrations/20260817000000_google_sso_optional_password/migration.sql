-- Sign-in becomes Google-only; a user no longer needs a stored password.
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;
