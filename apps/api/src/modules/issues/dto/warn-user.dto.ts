import { IsUUID } from 'class-validator';

export class WarnUserDto {
  @IsUUID() userId: string;
}
