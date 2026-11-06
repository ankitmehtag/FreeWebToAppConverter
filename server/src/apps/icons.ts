import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client, type StorageOptions } from '@sitetoapk/shared/s3';

export type IconStore = ReturnType<typeof createIconStore>;

export const iconKey = (appId: string) => `icons/${appId}.png`;
export const buildIconKey = (buildId: string) => `builds/${buildId}/icon.png`;

/** The private bucket. Icons are read back through the API, and APKs through short signed links. */
export const createIconStore = (options: StorageOptions) => {
  const { bucket } = options;
  const client = s3Client(options);

  return {
    put: async (key: string, data: Buffer) => {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: 'image/png' }));
    },

    get: async (key: string) => {
      try {
        const { Body } = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return Body ? Buffer.from(await Body.transformToByteArray()) : null;
      } catch (error) {
        if (error instanceof NoSuchKey) return null;
        throw error;
      }
    },

    /** Copies inside the bucket, so a build keeps the icon it started with. */
    copy: async (from: string, to: string) => {
      await client.send(new CopyObjectCommand({ Bucket: bucket, CopySource: `${bucket}/${from}`, Key: to }));
    },

    signedLink: (key: string, lifetimeSeconds: number) =>
      getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: lifetimeSeconds }),

    remove: async (key: string) => {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
};
