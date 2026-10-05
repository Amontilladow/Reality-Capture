import { IsUUID } from 'class-validator';

export class AddOrganizationMemberDto {
  @IsUUID() userId: string;
}
