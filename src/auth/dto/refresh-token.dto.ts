import { IsIn, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiPropertyOptional({ enum: ['mobile', 'web'] })
  @IsOptional()
  @IsIn(['mobile', 'web'])
  client?: 'mobile' | 'web';

  @ApiProperty({ description: 'Refresh token returned by login or register' })
  @IsString()
  @MinLength(20)
  refreshToken: string;
}
