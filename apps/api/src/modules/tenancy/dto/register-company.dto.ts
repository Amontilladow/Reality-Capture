import { IsString, IsEmail, MinLength, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterCompanyDto {
  @ApiProperty({ example: 'Al Futtaim Engineering' })
  @IsString() @MinLength(2) @MaxLength(255)
  companyName: string;

  @ApiProperty({ example: 'al-futtaim-engineering', description: 'URL-safe slug, letters/numbers/hyphens only' })
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug must be lowercase letters, numbers, and hyphens only.' })
  @MinLength(3) @MaxLength(100)
  slug: string;

  @ApiProperty({ example: 'admin@company.com' })
  @IsEmail()
  adminEmail: string;

  @IsString() @MinLength(2) adminFirstName: string;
  @IsString() @MinLength(2) adminLastName: string;

  @IsString() @MinLength(8)
  adminPassword: string;
}
