import { IsString, IsOptional, IsUUID, IsDateString, IsArray, IsIn } from 'class-validator';

export class UpdateIssueDto {
  @IsOptional() @IsString()  title?: string;
  @IsOptional() @IsString()  description?: string;
  @IsOptional() @IsIn(['critical','high','medium','low']) priority?: string;
  @IsOptional() @IsIn(['open','assigned','in_progress','resolved','under_review','closed','void']) status?: string;
  @IsOptional() @IsString()  discipline?: string;
  @IsOptional() @IsString()  trade?: string;
  @IsOptional() @IsUUID()    assignedTo?: string;
  @IsOptional() @IsString()  responsibleCompany?: string;
  @IsOptional() @IsDateString() deadline?: string;
  @IsOptional() @IsArray()   tags?: string[];
}