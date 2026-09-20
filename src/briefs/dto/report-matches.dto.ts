import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * One matched conversation — match METADATA only (tracker §5.3): the app's
 * conversation id, how many prompts matched, and their exact-hash
 * fingerprints. No text, no spec-evaluation details.
 */
export class MatchedConversationDto {
  @ApiProperty({
    description:
      'App-side conversation id (same as the refinement conversationId)',
  })
  @IsString()
  @MaxLength(200)
  conversationId: string;

  @ApiProperty({
    description: 'Number of prompts in the matched conversation',
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  promptCount: number;

  @ApiProperty({
    description:
      'Exact SHA-256 fingerprints of the matched prompts, in turn order',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  @Matches(/^[0-9a-f]{64}$/, { each: true })
  fingerprints: string[];
}

export class ReportMatchesDto {
  @ApiProperty({ description: 'Brief ref from the push payload' })
  @IsString()
  @MaxLength(64)
  briefRef: string;

  @ApiProperty({ type: [MatchedConversationDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => MatchedConversationDto)
  conversations: MatchedConversationDto[];
}
