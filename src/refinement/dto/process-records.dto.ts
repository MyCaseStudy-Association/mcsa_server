import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

/**
 * Builds #8.1/#8.2: per-conversation metadata computed ON-DEVICE from the
 * original text, once, and consumed everywhere downstream (packaged record,
 * QA gate). Labels and versions only — never text.
 */
export class ConversationMetaDto {
  @ApiProperty({ description: "Same id as the records' conversationId" })
  @IsString()
  @MaxLength(200)
  conversationId!: string;

  @ApiProperty({
    description:
      'Device domain tags (deterministic dictionary, >=1, "general" fallback)',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @Matches(/^[a-z][a-z0-9_]{0,39}$/, { each: true })
  domainTags!: string[];

  @ApiProperty({ description: 'Domain tagger version' })
  @IsString()
  @MaxLength(16)
  domainTaggerVersion!: string;

  @ApiProperty({
    description: 'Device language verdict; only "en" is sellable in the MVP',
    enum: ['en', 'other', 'und'],
  })
  @IsIn(['en', 'other', 'und'])
  language!: 'en' | 'other' | 'und';

  @ApiProperty({ description: 'Language gate version' })
  @IsString()
  @MaxLength(16)
  languageGateVersion!: string;
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

  /**
   * One entry per conversation in `records`. Optional for older clients:
   * a conversation without one is packaged as language "und" and tags
   * ["general"], which fails QA closed for any brief with a language.
   */
  @ApiPropertyOptional({ type: [ConversationMetaDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConversationMetaDto)
  @ArrayMaxSize(500)
  conversations?: ConversationMetaDto[];
}
