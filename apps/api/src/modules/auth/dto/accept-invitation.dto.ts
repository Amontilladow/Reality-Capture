import { IsString, MinLength } from 'class-validator';
export class AcceptInvitationDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(2)
  firstName: string;

  @IsString()
  @MinLength(2)
  lastName: string;

  @IsString()
  @MinLength(8)
  password: string;
}