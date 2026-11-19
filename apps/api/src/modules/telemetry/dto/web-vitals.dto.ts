import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export const WEB_VITAL_NAMES = ['CLS', 'FCP', 'INP', 'LCP', 'TTFB'] as const;

export class WebVitalMetricDto {
  @IsIn(WEB_VITAL_NAMES)
  name!: (typeof WEB_VITAL_NAMES)[number];

  @IsNumber()
  value!: number;

  @IsIn(['good', 'needs-improvement', 'poor'])
  rating!: 'good' | 'needs-improvement' | 'poor';

  @IsOptional()
  @IsString()
  @MaxLength(40)
  navigationType?: string;
}

export class WebVitalsReportDto {
  @IsString()
  @MaxLength(200)
  path!: string;

  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => WebVitalMetricDto)
  metrics!: WebVitalMetricDto[];
}
