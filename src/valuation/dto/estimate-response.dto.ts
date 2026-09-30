import { ApiProperty } from '@nestjs/swagger';
import type { EstimateResponse } from '../valuation.types';

/** Swagger schema for the estimate response (the app is written against it). */
export class EstimateResponseDto implements EstimateResponse {
  @ApiProperty({
    description:
      'Low end, integer cents (high × (1 − attrition), rounded down)',
    example: 25,
  })
  lowCents!: number;

  @ApiProperty({ description: 'High end, integer cents', example: 51 })
  highCents!: number;

  @ApiProperty({ enum: ['USD'], example: 'USD' })
  currency!: 'USD';

  @ApiProperty({ description: 'Pricing schedule version used', example: '0.1' })
  scheduleVersion!: string;
}
