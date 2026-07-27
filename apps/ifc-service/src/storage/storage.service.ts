import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { Readable } from 'stream';

@Injectable()
export class StorageService {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly config: ConfigService) {
    this.bucket = config.get<string>('storage.bucket')!;
    this.s3 = new S3Client({
      endpoint: config.get<string>('storage.endpoint'),
      region: config.get<string>('storage.region', 'us-east-1'),
      credentials: {
        accessKeyId: config.get<string>('storage.accessKeyId')!,
        secretAccessKey: config.get<string>('storage.secretAccessKey')!,
      },
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }

  // Streams the object body directly into a Buffer. web-ifc's API needs
  // the full byte array to open a model (see IFC_ARCHITECTURE_PROPOSAL.md —
  // no parser, including this one, avoids materializing the full file;
  // that's an inherent constraint of reading an arbitrary IFC entity graph,
  // not something this service adds on top). What THIS service controls is
  // not holding extra copies beyond that one buffer — no intermediate
  // string conversion, no duplicate array — and streaming the download
  // itself rather than buffering it twice.
  async download(key: string): Promise<Uint8Array> {
    const result = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const stream = result.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    const buf = Buffer.concat(chunks);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  async upload(key: string, body: Uint8Array, contentType = 'application/octet-stream'): Promise<void> {
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
  }

  generateFragmentsKey(companyId: string, projectId: string, modelId: string): string {
    return `${companyId}/bim-fragments/${projectId}/${modelId}.frag`;
  }
}
