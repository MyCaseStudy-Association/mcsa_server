import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Crossing (1) payload. The global ValidationPipe runs with
 * `forbidNonWhitelisted`, so a request carrying any extra field —
 * `originalText` included — is rejected at the boundary (INV-1 test point).
 */
export class ProcessRecordDto {
  @IsString()
  @MaxLength(200)
  clientRecordId!: string;

  /** Build #1 (APP-D-08): groups prompts of one chat. Counts/ids only. */
  @IsString()
  @MaxLength(200)
  conversationId!: string;

  /** Original position in the chat — order is the product. */
  @IsInt()
  @Min(0)
  turnIndex!: number;

  @IsString()
  @MaxLength(20000)
  refinedText!: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  flaggedCategoryIds!: string[];

  @Matches(/^[0-9a-f]{64}$/)
  exactHash!: string;

  @Matches(/^[0-9a-f]{16}$/)
  simHash!: string;

  /** Epoch seconds of the source chat's creation; coarsened to a quarter. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  capturedAt?: number;
}

/**
 * Build #4: what the contributor was shown at the Stage 5 gate. Feeds the
 * per-conversation consent receipt (§5.2, Kantara / ISO 27560 pattern).
 */
export class ConsentContextDto {
  @IsString()
  @MaxLength(40)
  disclosuresVersion!: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  disclosuresShown!: string[];

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  buyerCategories!: string[];

  @IsIn(['US', 'CA'])
  jurisdiction!: 'US' | 'CA';
}

export class ProcessRecordsDto {
  @IsString()
  @MaxLength(40)
  rulesetVersion!: string;

  /** Which assistant the export came from — retained server-side only. */
  @IsString()
  @MaxLength(40)
  sourceProvider!: string;

  @ValidateNested()
  @Type(() => ConsentContextDto)
  consent!: ConsentContextDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcessRecordDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  records!: ProcessRecordDto[];
}
