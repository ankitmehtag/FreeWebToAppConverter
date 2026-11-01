import { createStorage } from './storage';

export const requireEnv = (name: string) => {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing environment variable ${name}`);
    process.exit(1);
  }
  return value;
};

export const storageFromEnv = () =>
  createStorage({
    endpoint: requireEnv('R2_ENDPOINT'),
    bucket: requireEnv('R2_BUCKET'),
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
  });
