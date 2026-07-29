import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { ProcessRecordsDto } from './dto/process-records.dto';
import { ProcessResponse, RefinementService } from './refinement.service';

@ApiTags('refinement')
@ApiBearerAuth()
@Controller('refinement')
export class RefinementController {
  constructor(private readonly refinementService: RefinementService) {}

  @Post('process')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Stage 6 — precise de-identification of first-pass-redacted prompts (ephemeral, in-memory)',
  })
  process(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ProcessRecordsDto,
  ): Promise<ProcessResponse> {
    return this.refinementService.process(request.user.sub, dto);
  }
}
