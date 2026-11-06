// Takes an app down, or restores it, until the admin panel (F17) does this from a screen.
// Usage: takedown.ts <appId> --reason "…" --operator "…" [--restore]
import { parseArgs } from 'node:util';
import { MongoClient, ObjectId } from 'mongodb';
import { restore, takeDown } from '../src/abuse/takedown';
import { createIconStore } from '../src/apps/icons';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { reason: { type: 'string' }, operator: { type: 'string' }, restore: { type: 'boolean', default: false } },
});

const [appId] = positionals;
if (!appId || !/^[0-9a-f]{24}$/.test(appId) || !values.reason?.trim() || !values.operator?.trim()) {
  console.error('Usage: takedown.ts <appId> --reason "…" --operator "…" [--restore]');
  process.exit(1);
}

const requireEnv = (name: string) => {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing environment variable ${name}`);
    process.exit(1);
  }
  return value;
};

const mongo = await new MongoClient(requireEnv('MONGO_URL')).connect();
const db = mongo.db();
const action = { reason: values.reason.trim(), operator: values.operator.trim() };
try {
  if (values.restore) {
    await restore({ db }, new ObjectId(appId), action);
    console.log('Restored. New builds and edits are allowed again; deleted APKs stay deleted.');
  } else {
    const storage = createIconStore({
      endpoint: requireEnv('R2_ENDPOINT'),
      bucket: requireEnv('R2_BUCKET'),
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    });
    const { deleted } = await takeDown({ db, storage }, new ObjectId(appId), action);
    console.log(`Taken down. Deleted ${deleted.length} APK(s); their links no longer work.`);
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await mongo.close();
}
