import { readFile } from 'node:fs/promises';
import {
  DeleteObjectCommand,
  GetBucketLifecycleConfigurationCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const LINK_LIFETIME_SECONDS = 60 * 60;
export const FREE_RETENTION_DAYS = 7;
const FREE_PREFIX = 'free/';

export type StorageOptions = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  pathStyle?: boolean;
};

export type Storage = ReturnType<typeof createStorage>;

export const artifactKey = (plan: 'free' | 'premium', buildId: string) => `${plan}/${buildId}.apk`;

export const createStorage = ({ endpoint, bucket, accessKeyId, secretAccessKey, pathStyle = false }: StorageOptions) => {
  const client = new S3Client({
    endpoint,
    region: 'auto',
    forcePathStyle: pathStyle,
    credentials: { accessKeyId, secretAccessKey },
    // R2 rejects the checksum headers this client now sends by default.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  return {
    /** Uploads a file and returns the size the bucket reports, confirming it arrived. */
    put: async (key: string, path: string) => {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: await readFile(path),
          ContentType: 'application/vnd.android.package-archive',
          ContentDisposition: 'attachment; filename="app.apk"',
        }),
      );
      const { ContentLength } = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return ContentLength ?? 0;
    },

    signedLink: (key: string, lifetimeSeconds: number) =>
      getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: lifetimeSeconds }),

    remove: async (key: string) => {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    applyLifecycle: async () => {
      await client.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: bucket,
          LifecycleConfiguration: {
            Rules: [
              {
                ID: 'expire-free-artifacts',
                Status: 'Enabled',
                Filter: { Prefix: FREE_PREFIX },
                Expiration: { Days: FREE_RETENTION_DAYS },
              },
            ],
          },
        }),
      );
    },

    readLifecycle: async () => {
      const { Rules = [] } = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }));
      return Rules.map((rule) => ({
        prefix: rule.Filter?.Prefix,
        days: rule.Expiration?.Days,
        enabled: rule.Status === 'Enabled',
      }));
    },
  };
};
