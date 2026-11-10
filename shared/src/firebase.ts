import { createSign } from 'node:crypto';

/** What the apps need to start Firebase. None of it is secret. */
export type FirebaseClient = { apiKey: string; appId: string; projectId: string; senderId: string };

export type ServiceAccount = { client_email: string; private_key: string; project_id: string };

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MANAGEMENT = 'https://firebase.googleapis.com';
const OPERATION_POLLS = 20;
const OPERATION_WAIT_MS = 1500;

const base64Url = (value: Buffer | string) => Buffer.from(value).toString('base64url');

/** Reads the service account from `FIREBASE_SERVICE_ACCOUNT_B64`, or returns undefined while push is off. */
export const serviceAccountFromEnv = (env: NodeJS.ProcessEnv = process.env): ServiceAccount | undefined => {
  const encoded = env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!encoded) return undefined;
  const account = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as Partial<ServiceAccount>;
  if (!account.client_email || !account.private_key || !account.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT_B64 is not a service account key');
  return account as ServiceAccount;
};

const accessToken = async (account: ServiceAccount, scope: string, fetcher: typeof fetch) => {
  const now = Math.floor(Date.now() / 1000);
  const claims = base64Url(JSON.stringify({ iss: account.client_email, scope, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const unsigned = `${base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${claims}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key);
  const response = await fetcher(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${base64Url(signature)}` }),
  });
  if (!response.ok) throw new Error(`Google sign-in answered ${response.status}`);
  return ((await response.json()) as { access_token: string }).access_token;
};

const call = async <T>(fetcher: typeof fetch, token: string, url: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetcher(url, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  if (!response.ok) throw new Error(`Firebase answered ${response.status} for ${new URL(url).pathname.split('/').slice(-1)[0]}`);
  return (await response.json()) as T;
};

type AndroidApp = { appId: string; packageName: string };

/** Finds the Firebase app for a package name, creating it the first time. */
export const ensureFirebaseApp = async (account: ServiceAccount, packageName: string, fetcher: typeof fetch = fetch): Promise<FirebaseClient> => {
  const token = await accessToken(account, 'https://www.googleapis.com/auth/firebase', fetcher);
  const parent = `${MANAGEMENT}/v1beta1/projects/${account.project_id}/androidApps`;

  const listed = await call<{ apps?: AndroidApp[] }>(fetcher, token, `${parent}?pageSize=100`);
  let appId = listed.apps?.find((app) => app.packageName === packageName)?.appId;

  if (!appId) {
    let operation = await call<{ name: string; done?: boolean; response?: AndroidApp }>(fetcher, token, parent, {
      method: 'POST',
      body: JSON.stringify({ packageName, displayName: packageName }),
    });
    for (let poll = 0; !operation.done && poll < OPERATION_POLLS; poll++) {
      await new Promise((resolve) => setTimeout(resolve, OPERATION_WAIT_MS));
      operation = await call(fetcher, token, `${MANAGEMENT}/v1/${operation.name}`);
    }
    appId = operation.response?.appId;
    if (!appId) throw new Error('Firebase did not finish creating the app');
  }

  const { configFileContents } = await call<{ configFileContents: string }>(fetcher, token, `${parent}/${appId}/config`);
  const config = JSON.parse(Buffer.from(configFileContents, 'base64').toString('utf8'));
  const client = config.client?.[0];
  const apiKey = client?.api_key?.[0]?.current_key;
  if (!apiKey || !client?.client_info?.mobilesdk_app_id) throw new Error('Firebase returned an incomplete config');
  return {
    apiKey,
    appId: client.client_info.mobilesdk_app_id,
    projectId: config.project_info.project_id,
    senderId: config.project_info.project_number,
  };
};

/** The topic one app's devices subscribe to. Topics are shared across a project, so it carries our app id. */
export const topicFor = (appId: string) => `app-${appId}`;

/** Sends a notification to every device that has the app. */
export const sendToApp = async (
  account: ServiceAccount,
  appId: string,
  message: { title: string; body: string },
  fetcher: typeof fetch = fetch,
) => {
  const token = await accessToken(account, 'https://www.googleapis.com/auth/firebase.messaging', fetcher);
  await call(fetcher, token, `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
    method: 'POST',
    body: JSON.stringify({ message: { topic: topicFor(appId), notification: message } }),
  });
};
