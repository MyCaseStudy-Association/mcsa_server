import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** Longest plausible chat; also keeps the cents sum far below 2^53. */
const MAX_PER_TIER = 10000;

/**
 * One selected, brief-matched conversation — tier COUNTS of its
 * Stage-4-kept prompts, nothing else (D2/D3, 29 Sep). No ids, no text:
 * the global pipe's `forbidNonWhitelisted` rejects any extra field.
 */
export class TierCountsDto {
  @ApiProperty({ description: 'Prompts with < 10 words', minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(MAX_PER_TIER)
  short!: number;

  @ApiProperty({ description: 'Prompts with 10–50 words', minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(MAX_PER_TIER)
  medium!: number;

  @ApiProperty({ description: 'Prompts with > 50 words', minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(MAX_PER_TIER)
  long!: number;
}

export class EstimateRequestDto {
  @ApiProperty({
    description:
      'One entry per selected, brief-matched conversation (a chat matching several briefs is still ONE entry).',
    type: [TierCountsDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => TierCountsDto)
  conversations!: TierCountsDto[];
}
