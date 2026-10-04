import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
export class ConnectAccountDto {
  @ApiProperty({
    example: 'US',
    description: 'Contributor country; must be enabled on the platform',
  })
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  country!: string;
}
