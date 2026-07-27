import { IsString, IsNumber, IsOptional, IsUUID, IsPositive, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UploadUrlDto {
  @ApiProperty({ example: 'level10-northeast-corner.jpg' })
  @IsString()
  filename: string;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  mimeType: string;

  @ApiProperty({ example: 15728640, description: 'File size in bytes' })
  @IsNumber()
  @IsPositive()
  sizeBytes: number;

  @ApiProperty({ enum: ['photo_360', 'photo_standard', 'video'] })
  @IsIn(['photo_360', 'photo_standard', 'video'])
  captureType: 'photo_360' | 'photo_standard' | 'video';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  locationId?: string;
}