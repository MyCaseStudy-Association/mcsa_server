import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class BriefSpecDto {
  @ApiProperty({ type: [String], example: ['coding'] })
  @IsArray()
  @ArrayMaxSize(30)
  @IsIn(['coding', 'writing', 'business', 'education', 'general'], {
    each: true,
  })
  domains: string[];
  @ApiProperty({ type: [String], example: ['en'] })
  @IsArray()
  @ArrayMaxSize(1)
  @IsIn(['en'], { each: true })
  languages: string[];
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  keywordsAny: string[];
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  keywordsAll: string[];
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  keywordsNone: string[];
  @ApiProperty({ minimum: 1, maximum: 1000 })
  @IsInt()
  @Min(1)
  @Max(1000)
  minPromptsPerConversation: number;
}
class BriefQualityDto {
  @ApiProperty({ minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0)
  @Max(1)
  maxRedactionDensity: number;
  @ApiProperty({ enum: ['exact', 'exact+near'] })
  @IsIn(['exact', 'exact+near'])
  dedupGuarantee: 'exact' | 'exact+near';
}
class BriefVolumeDto {
  @ApiProperty({ minimum: 1, maximum: 1000000 })
  @IsInt()
  @Min(1)
  @Max(1000000)
  targetConversations: number;
  @ApiProperty({ nullable: true, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  maxPerContributor: number | null;
}
export class CreateBriefDto {
  @ApiProperty({ type: BriefSpecDto })
  @IsObject()
  @ValidateNested()
  @Type(() => BriefSpecDto)
  spec: BriefSpecDto;
  @ApiProperty({ type: BriefQualityDto })
  @IsObject()
  @ValidateNested()
  @Type(() => BriefQualityDto)
  quality: BriefQualityDto;
  @ApiProperty({ type: BriefVolumeDto })
  @IsObject()
  @ValidateNested()
  @Type(() => BriefVolumeDto)
  volume: BriefVolumeDto;
  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  expiresAt: string;
}
