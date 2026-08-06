import { IsString, IsOptional, MinLength, MaxLength, IsIn, IsDateString } from 'class-validator';

export class CreateTransmittalDto {
  @IsString() @MinLength(3) @MaxLength(500)
  subject: string;

  @IsString() @MinLength(1) @MaxLength(255)
  recipientName: string;

  @IsOptional() @IsString() recipientCompany?: string;
  @IsOptional() @IsIn(['for_review', 'for_approval', 'for_record', 'for_construction', 'as_requested']) purpose?: string;

  @IsString() @MinLength(1)
  items: string;

  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}
