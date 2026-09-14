import { IsUUID } from 'class-validator';

export class AttributeActivityDto {
  @IsUUID() projectId: string;
}
