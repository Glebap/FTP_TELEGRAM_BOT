import 'dotenv/config';
import { z } from 'zod';

const csvNumbers = z
  .string()
  .default('')
  .transform((raw) =>
    raw
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => BigInt(part)),
  );

const schema = z.object({
  BOT_TOKEN: z.string().min(10, 'BOT_TOKEN is missing — copy .env.example to .env'),
  ADMIN_IDS: csvNumbers,
  DATABASE_URL: z.string().min(1),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DIGEST_ENABLED: z
    .string()
    .default('true')
    .transform((value) => value.toLowerCase() !== 'false'),
  /** Local times of day when the digest goes out, e.g. "10:00,19:00". */
  DIGEST_TIMES: z
    .string()
    .default('10:00,19:00')
    .transform((raw, ctx) => {
      const times = raw
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);

      for (const time of times) {
        if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `"${time}" is not a HH:MM time`,
          });
        }
      }
      return times;
    }),
  DIGEST_TIMEZONE: z.string().default('Europe/Chisinau'),
  SEARCH_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  CONTACT_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(5),
  CONTACT_LIMIT_PER_DAY: z.coerce.number().int().positive().default(30),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';

export function isAdmin(telegramId: bigint | number): boolean {
  const id = typeof telegramId === 'bigint' ? telegramId : BigInt(telegramId);
  return env.ADMIN_IDS.some((adminId) => adminId === id);
}
