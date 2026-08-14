import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import type { Readable } from 'stream';

@Injectable()
export class StorageService {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly presignExpiresIn: number;
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly config: ConfigService) {
    this.bucket = config.get<string>('storage.bucket')!;
    this.presignExpiresIn = config.get<number>('storage.presignExpiresIn', 3600);
    this.s3 = new S3Client({
      endpoint: config.get<string>('storage.endpoint'),
      region: config.get<string>('storage.region', 'us-east-1'),
      credentials: {
        accessKeyId: config.get<string>('storage.accessKeyId')!,
        secretAccessKey: config.get<string>('storage.secretAccessKey')!,
      },
      forcePathStyle: true, // Required for MinIO and Cloudflare R2
      // Newer SDK versions add a checksum by default to every request/presigned
      // URL. Cloudflare R2 (and MinIO) don't handle that identically to real S3
      // in the presigned-URL signing flow, which breaks the signature entirely.
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }

  // Generate a key for a new object — structured for easy browsing and lifecycle rules
  generateKey(companyId: string, projectId: string, type: 'captures' | 'drawings' | 'documents' | 'avatars' | 'issues' | 'rfi-attachments' | 'branding', filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() ?? 'bin';
    return `${companyId}/${type}/${projectId}/${randomUUID()}.${ext}`;
  }

  // Get a presigned URL for direct browser upload (client never touches our server for file data)
  //
  // Deliberately does NOT sign ContentLength: several callers only have a
  // maximum-allowed size at this point, not the real file size, and since
  // ContentLength is a signed header, presigning it forces the actual PUT's
  // Content-Length to match exactly or the provider rejects it as a
  // signature mismatch -- breaking every upload that isn't precisely that
  // many bytes. Real max-size enforcement belongs in a bucket lifecycle
  // rule or a post-upload check, not the signature.
  async getUploadUrl(key: string, contentType: string, _maxSizeBytes?: number): Promise<{ uploadUrl: string; storageKey: string }> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      Metadata: { uploadedAt: new Date().toISOString() },
    });

    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 900 }); // 15 min for upload
    return { uploadUrl, storageKey: key };
  }

  // Get a presigned URL for reading a private object
  async getReadUrl(key: string, expiresIn?: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn: expiresIn ?? this.presignExpiresIn });
  }

  // Resolve multiple keys to presigned URLs in one call (batch for list endpoints)
  async resolveUrls(keys: (string | null | undefined)[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    await Promise.all(
      keys.filter(Boolean).map(async (key) => {
        try {
          result.set(key!, await this.getReadUrl(key!));
        } catch (err) {
          this.logger.warn(`Could not generate URL for key ${key!}`, err);
        }
      }),
    );
    return result;
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  // Server-side download/upload, for workers that actually need the bytes
  // (e.g. image-processing.processor.ts generating renditions) rather than
  // just handing the client a presigned URL. Mirrors
  // apps/ifc-service/src/storage/storage.service.ts's implementation.
  async download(key: string): Promise<Buffer> {
    const result = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const stream = result.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async upload(key: string, body: Buffer, contentType = 'application/octet-stream'): Promise<void> {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }
}