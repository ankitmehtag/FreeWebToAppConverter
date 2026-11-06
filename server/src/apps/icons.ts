import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, type StorageOptions } from '@sitetoapk/shared/s3';

export type IconStore = ReturnType<typeof createIconStore>;

export const iconKey = (appId: string) => `icons/${appId}.png`;

/** Keeps icons in the private bucket. They are only ever read back through the API. */
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

    remove: async (key: string) => {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
};
