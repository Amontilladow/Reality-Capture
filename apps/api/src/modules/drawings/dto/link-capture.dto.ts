import { IsUUID, IsNumber } from 'class-validator';

export class LinkCaptureToDrawingDto {
  @IsUUID()   captureId: string;
  @IsNumber() posXNorm: number;   // normalized 0.0–1.0 on the drawing canvas
  @IsNumber() posYNorm: number;
}