import { randomUUID } from 'node:crypto';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { createStorage } from '../src/storage';

export const localS3 = {
  endpoint: 'http://127.0.0.1:9000',
  accessKeyId: 'sitetoapk-local',
  secretAccessKey: 'sitetoapk-local-only',
};

export const testStorage = async () => {
  const bucket = `test-${randomUUID()}`;
  const client = new S3Client({
    endpoint: localS3.endpoint,
    region: 'auto',
    forcePathStyle: true,
    credentials: { accessKeyId: localS3.accessKeyId, secretAccessKey: localS3.secretAccessKey },
  });
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  return createStorage({ ...localS3, bucket, pathStyle: true });
};
