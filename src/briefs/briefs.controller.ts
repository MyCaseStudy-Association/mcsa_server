import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { BriefsService } from './briefs.service';
import type { DevicePushPayload } from './briefs.types';
import { ReportMatchesDto } from './dto/report-matches.dto';

/**
 * INV-8: briefs are never browsable. `push` returns the minimal matching
 * payload for on-device matching; the app renders only matches. There is
 * no list, search, or detail endpoint.
 */
@ApiTags('briefs')
@ApiBearerAuth()
@Controller('briefs')
export class BriefsController {
  constructor(private readonly briefsService: BriefsService) {}

  @Get('push')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Device push payload: live, escrow-committed briefs as {briefRef, categoryId, spec, quality} for on-device matching. No buyer identity, price or volume (INV-8, §5.3).',
  })
  @ApiResponse({ status: 200, description: 'Push payload returned' })
  push(): Promise<DevicePushPayload> {
    return this.briefsService.pushPayload();
  }

  @Post('matches')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Report on-device match metadata for one brief: conversation ids, prompt counts, fingerprints. Never content.',
  })
  @ApiResponse({ status: 200, description: 'Matches recorded' })
  reportMatches(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ReportMatchesDto,
  ): Promise<{ briefRef: string; recorded: number }> {
    return this.briefsService.reportMatches(request.user.sub, dto);
  }
}
