import { S3Client } from '@aws-sdk/client-s3';

export type StorageOptions = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  pathStyle?: boolean;
};

/** The one client setup for R2, used by the worker for artifacts and the server for icons. */
export const s3Client = ({ endpoint, accessKeyId, secretAccessKey, pathStyle = false }: StorageOptions) =>
  new S3Client({
    endpoint,
    region: 'auto',
    forcePathStyle: pathStyle,
    credentials: { accessKeyId, secretAccessKey },
    // R2 rejects the checksum headers this client now sends by default.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
