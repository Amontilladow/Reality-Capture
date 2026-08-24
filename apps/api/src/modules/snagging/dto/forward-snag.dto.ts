import { IsString, IsOptional, IsUUID } from 'class-validator';

export class ForwardSnagDto {
  @IsUUID() toUserId: string;
  @IsOptional() @IsString() comment?: string;
}
