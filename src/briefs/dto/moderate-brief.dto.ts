import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
export class ModerateBriefDto {
  @ApiProperty({ enum: ['live', 'paused'] })
  @IsIn(['live', 'paused'])
  status: 'live' | 'paused';
}
