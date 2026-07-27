import { registerAs } from '@nestjs/config';
export default registerAs('storage', () => ({
  endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.S3_REGION ?? 'us-east-1',
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  bucket: process.env.S3_BUCKET ?? 'engineeringos',
  presignExpiresIn: parseInt(process.env.S3_PRESIGN_EXPIRES_IN ?? '3600', 10),
}));
