import { IsInt, IsNumber, IsOptional, IsString, IsUUID, Min, MaxLength } from 'class-validator';

export class CreatePinDto {
  @IsNumber() posXNorm: number;   // normalized 0.0–1.0 on the drawing canvas
  @IsNumber() posYNorm: number;
  @IsOptional() @IsString() @MaxLength(255) name?: string;
  // Which page of a multi-page PDF this pin is on -- the page the client
  // had open when the pin was placed. Defaults to 1 (single-page drawings,
  // or page 1 of a multi-page one).
  @IsOptional() @IsInt() @Min(1) pageNumber?: number;
  // Forwarded straight through to the pin's auto-created Issue (see
  // drawings.service.ts createPin()) -- lets several pins in a row be
  // dropped pre-assigned to the same person.
  @IsOptional() @IsUUID() assignedTo?: string;
}
