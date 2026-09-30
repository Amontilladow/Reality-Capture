import { IsOptional, IsUUID } from 'class-validator';

export class AssignRiskOwnerDto {
  @IsOptional() @IsUUID()
  ownerId?: string;
}
