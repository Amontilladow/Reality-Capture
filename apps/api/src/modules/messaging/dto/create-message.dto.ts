import { ArrayNotEmpty, IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateMessageDto {
  @IsString()
  subject: string;

  @IsString()
  body: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  recipientUserIds: string[];

  @IsOptional()
  @IsUUID()
  projectId?: string;
}
