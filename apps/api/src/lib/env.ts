import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),
  CREDENTIALS_ENCRYPTION_KEY: z.string()
    .min(64, 'CREDENTIALS_ENCRYPTION_KEY must be at least 64 hex characters (256 bits)')
    .regex(/^[0-9a-fA-F]+$/, 'CREDENTIALS_ENCRYPTION_KEY must be hexadecimal'),
  SLACK_SIGNING_SECRET: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  APP_URL: z.string().optional().default('http://localhost:3000'),
  PORT: z.string().optional().default('3001'),
  HOST: z.string().optional().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).optional().default('development'),
  LOG_LEVEL: z.string().optional().default('info'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Environment validation failed:');
    for (const issue of result.error.issues) {
      console.error(`   ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  console.log('✅ Environment variables validated');
  return result.data;
}
