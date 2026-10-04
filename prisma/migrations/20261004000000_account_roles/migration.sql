CREATE TYPE "UserRole" AS ENUM ('user', 'buyer', 'admin');
ALTER TABLE "users" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'user';
ALTER TABLE "buyers" ADD COLUMN "user_id" UUID;
CREATE UNIQUE INDEX "buyers_user_id_key" ON "buyers"("user_id");
ALTER TABLE "buyers" ADD CONSTRAINT "buyers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
