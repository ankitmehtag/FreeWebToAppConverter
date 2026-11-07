// Copies one file to R2. Usage: node deploy/upload-backup.mjs <file> <key>. Reads R2_* from the environment.
import { createReadStream, statSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('/opt/sitetoapk/server/package.json');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const [file, key] = process.argv.slice(2);
const need = (name) => process.env[name] || (console.error(`${name} is not set`), process.exit(1));
const client = new S3Client({
  region: 'auto',
  endpoint: need('R2_ENDPOINT'),
  credentials: { accessKeyId: need('R2_ACCESS_KEY_ID'), secretAccessKey: need('R2_SECRET_ACCESS_KEY') },
});
await client.send(
  new PutObjectCommand({ Bucket: need('R2_BUCKET'), Key: key, Body: createReadStream(file), ContentLength: statSync(file).size }),
);
console.log(`Uploaded ${key}`);
