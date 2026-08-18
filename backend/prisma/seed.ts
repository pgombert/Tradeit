/**
 * Ensures the single user row exists. Sign-in is Google-only, so there is no
 * password to set — the account is also created automatically on first Google
 * sign-in, making this seed optional but handy for a fresh database.
 *
 *   npm run db:seed        create the account if it isn't there yet
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.ALLOWED_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error('ALLOWED_EMAIL must be set before seeding.');

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
  });

  console.log(`User ${user.email} is ready. Sign in with Google.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
