import { PrismaClient } from '@prisma/client';
import { isProduction } from '../config/environment.js';

export const prisma = new PrismaClient({
  log: isProduction ? ['error'] : ['warn', 'error'],
});
