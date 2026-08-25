import { IsString } from 'class-validator';

export class ReplyMessageDto {
  @IsString()
  body: string;
}
