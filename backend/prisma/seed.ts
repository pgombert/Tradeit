/**
 * Seeds the single user. Password comes from SEED_PASSWORD, or is generated and
 * printed once — it is never written to a file or committed.
 *
 *   npm run db:seed                          create the account
 *   SEED_PASSWORD='...' npm run db:seed      create it with a chosen password
 *   npm run db:seed -- --force               reset the password of an existing account
 */
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.ALLOWED_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error('ALLOWED_EMAIL must be set before seeding.');

  const force = process.argv.includes('--force');
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing && !force) {
    console.log(`User ${email} already exists — nothing to do.`);
    console.log('To reset the password: npm run db:seed -- --force');
    return;
  }

  const generated = !process.env.SEED_PASSWORD;
  const password = process.env.SEED_PASSWORD ?? randomBytes(18).toString('base64url');
  const passwordHash = await bcrypt.hash(password, 12);

  if (existing) {
    await prisma.user.update({ where: { email }, data: { passwordHash } });
    console.log(`Reset the password for ${email}`);
  } else {
    await prisma.user.create({ data: { email, passwordHash } });
    console.log(`Created user ${email}`);
  }

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
