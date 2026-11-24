import { config } from 'dotenv';
import { z } from 'zod';

// Tests provide their own environment and must not read local credentials.
if (process.env.NODE_ENV !== 'test') config();

const origin = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
});

const databaseUrl = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (url.protocol === 'postgres:' || url.protocol === 'postgresql:') && Boolean(url.hostname);
  } catch {
    return false;
  }
});

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().trim().min(1).default('0.0.0.0'),
  DATABASE_URL: databaseUrl,
  CORS_ORIGIN: origin,
  OWNER_USERNAME: z.string().trim().min(1).max(255),
  OWNER_PASSWORD_HASH: z.string().regex(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/),
  TOTP_SECRET: z.string().regex(/^[A-Z2-7]+=*$/i),
  JWT_SECRET: z.string().min(32),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const keys = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
  throw new Error(`Configuración inválida: ${keys.join(', ')}`);
}

export const env = parsed.data;