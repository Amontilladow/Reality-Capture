import { IsString, IsOptional, IsUUID } from 'class-validator';

export class ForwardIssueDto {
  @IsUUID() toUserId: string;
  @IsOptional() @IsString() comment?: string;
}
