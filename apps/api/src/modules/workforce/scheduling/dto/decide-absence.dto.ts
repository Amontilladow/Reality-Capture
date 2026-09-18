import { IsIn } from 'class-validator';

export class DecideAbsenceDto {
  @IsIn(['approved', 'denied'])
  status: 'approved' | 'denied';
}
