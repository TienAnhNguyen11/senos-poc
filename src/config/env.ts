import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  MONGO_URI: required('MONGO_URI'),
  JWT_SECRET: required('JWT_SECRET'),
  ANTHROPIC_API_KEY: required('ANTHROPIC_API_KEY'),
  PLATFORM_MONTHLY_CAPACITY: Number(required('PLATFORM_MONTHLY_CAPACITY')),
  PORT: Number(process.env.PORT ?? 3000),
};
