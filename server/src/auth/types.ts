export type Mail = { to: string; subject: string; text: string; html?: string };
export type Mailer = { send: (mail: Mail) => Promise<void> };

export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  issuer: string;
};

export type AuthConfig = {
  jwtSecret: string;
  appUrl: string;
  apiUrl: string;
  bcryptCost: number;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  verifyTtlMs: number;
  resetTtlMs: number;
  lockThreshold: number;
  lockMs: number;
  ipFailLimit: number;
  routeLimit: number;
  routeWindowMs: number;
  google?: GoogleConfig;
};
