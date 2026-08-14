import { IsString, IsOptional, IsDateString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProjectDto {
  @ApiProperty({ example: 'Marina Tower Development' })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: 'MRN-2024-001', required: false })
  @IsOptional() @IsString() code?: string;

  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() city?: string;

  @ApiProperty({ example: '2024-01-15', required: false })
  @IsOptional() @IsDateString() startDate?: string;

  @IsOptional() @IsDateString() expectedEndDate?: string;

  // Stakeholder directory -- set once per project, pulled automatically
  // onto every RFI PDF instead of being re-typed per document.
  @ApiProperty({ example: 'CSC', required: false })
  @IsOptional() @IsString() orgCode?: string;

  @IsOptional() @IsString() clientName?: string;
  @IsOptional() @IsString() leadDesigner?: string;
  @IsOptional() @IsString() consultantName?: string;
  @IsOptional() @IsString() technicalAdvisor?: string;
  @IsOptional() @IsString() pmcName?: string;
  @IsOptional() @IsString() mainContractor?: string;
  @IsOptional() @IsString() subcontractor?: string;
}