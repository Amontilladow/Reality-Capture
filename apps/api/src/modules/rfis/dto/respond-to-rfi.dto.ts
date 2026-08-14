import { IsString, MinLength } from 'class-validator';

// Body for POST :id/respond.
export class RespondToRfiDto {
  @IsString() @MinLength(1)
  answer: string;
}
