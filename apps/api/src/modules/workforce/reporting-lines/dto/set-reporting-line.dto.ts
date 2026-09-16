import { IsUUID } from 'class-validator';

export class SetReportingLineDto {
  @IsUUID() userId: string;
  @IsUUID() managerId: string;
}
