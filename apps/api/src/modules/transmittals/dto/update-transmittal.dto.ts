import { IsString, IsOptional, MaxLength, IsIn, IsDateString } from 'class-validator';

export class UpdateTransmittalDto {
  @IsOptional() @IsString() @MaxLength(500) subject?: string;
  @IsOptional() @IsString() @MaxLength(255) recipientName?: string;
  @IsOptional() @IsString() recipientCompany?: string;
  @IsOptional() @IsIn(['for_review', 'for_approval', 'for_record', 'for_construction', 'as_requested']) purpose?: string;
  @IsOptional() @IsString() items?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsIn(['draft', 'sent', 'acknowledged', 'void']) status?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}
