import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
export class QuoteBriefDto {
  @ApiProperty({
    description:
      'Total buyer funding in USD cents, set by moderator before checkout',
    minimum: 50,
    maximum: 99999999,
  })
  @IsInt()
  @Min(50)
  @Max(99999999)
  amountCents: number;
}
