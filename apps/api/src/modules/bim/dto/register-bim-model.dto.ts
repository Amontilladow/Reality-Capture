import { IsString, IsOptional, IsIn, MinLength, MaxLength } from 'class-validator';

export class RegisterBimModelDto {
  @IsString() @MinLength(1) @MaxLength(255)
  name: string;

  @IsString()
  storageKey: string;

  // Only 'IFC' is actually parsed end-to-end today (apps/ifc-service's
  // processor assumes IFC SPF syntax unconditionally) -- NWD/RVT are kept
  // here as already-existing schema/column values (bim_models.format,
  // never enforced before this DTO existed) rather than removed, since
  // dropping them would be a behavior change beyond this fix's scope.
  @IsOptional() @IsIn(['IFC', 'NWD', 'RVT'])
  format?: string;

  @IsOptional() @IsString() @MaxLength(20)
  ifcSchema?: string;

  @IsOptional() @IsString() @MaxLength(255)
  originalFilename?: string;
}
