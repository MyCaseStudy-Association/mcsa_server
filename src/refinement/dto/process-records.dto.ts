import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  Matches,
  MaxLength,
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
}

export class ProcessRecordsDto {
  @IsString()
  @MaxLength(40)
  rulesetVersion!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcessRecordDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  records!: ProcessRecordDto[];
}
