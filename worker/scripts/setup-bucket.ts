// Applies the artifact expiry rule to the bucket in R2_BUCKET, then reads it back.
import { storageFromEnv } from '../src/env';

const storage = storageFromEnv();
await storage.applyLifecycle();
console.log(await storage.readLifecycle());
