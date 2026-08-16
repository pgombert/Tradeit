/**
 * Seeds the single user. Password comes from SEED_PASSWORD, or is generated and
 * printed once — it is never written to a file or committed.
 *
 *   SEED_PASSWORD='...' npm run db:seed
 */
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.ALLOWED_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error('ALLOWED_EMAIL must be set before seeding.');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`User ${email} already exists — nothing to do.`);
    return;
  }

  const generated = !process.env.SEED_PASSWORD;
  const password = process.env.SEED_PASSWORD ?? randomBytes(18).toString('base64url');

  await prisma.user.create({
    data: { email, passwordHash: await bcrypt.hash(password, 12) },
  });

  console.log(`Created user ${email}`);
  if (generated) {
    console.log(`\n  Password: ${password}\n\nStore it now — it is not saved anywhere.`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
