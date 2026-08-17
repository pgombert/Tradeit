import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4002),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),

  // Single-user gate. Only this address may hold an account or sign in.
  ALLOWED_EMAIL: z.string().email(),
  JWT_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),

  FRONTEND_URL: z.string().url().default('http://localhost:3002'),
  CORS_ORIGIN: z.string().default('http://localhost:3002'),

  FRED_ID: z.string().optional(),
  FINHUB_APIKEY: z.string().optional(),

  SCHWAB_CLIENT_ID: z.string().optional(),
  SCHWAB_CLIENT_SECRET: z.string().optional(),
  SCHWAB_REDIRECT_URI: z.string().optional(),

  STARTING_CAPITAL: z.coerce.number().positive().default(100_000),
  MAX_DRAWDOWN: z.coerce.number().positive().default(30_000),

  ANTHROPIC_API_KEY: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

if (env.MAX_DRAWDOWN >= env.STARTING_CAPITAL) {
  throw new Error(
    `MAX_DRAWDOWN (${env.MAX_DRAWDOWN}) must be below STARTING_CAPITAL (${env.STARTING_CAPITAL}).`,
  );
}

export const isProduction = env.NODE_ENV === 'production';
