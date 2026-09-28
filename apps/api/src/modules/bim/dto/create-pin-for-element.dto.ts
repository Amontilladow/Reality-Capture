import { IsString, IsOptional, IsUUID, MaxLength } from 'class-validator';

export class CreatePinForElementDto {
  @IsOptional() @IsString() @MaxLength(255)
  name?: string;

  @IsOptional() @IsUUID()
  assignedTo?: string;
}
