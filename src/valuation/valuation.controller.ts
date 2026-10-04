import { Roles } from '../auth/roles.decorator';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EstimateRequestDto } from './dto/estimate-request.dto';
import { EstimateResponseDto } from './dto/estimate-response.dto';
import { ValuationService } from './valuation.service';
import type { EstimateResponse } from './valuation.types';

@ApiTags('valuation')
@ApiBearerAuth()
@Roles('user')
@Controller('valuation')
export class ValuationController {
  constructor(private readonly valuationService: ValuationService) {}

  @Post('estimate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Rough estimate for the consent screen: per-conversation tier counts in, NET range in integer cents out. Ephemeral, never billed (Build #6 §6.2).',
  })
  @ApiResponse({
    status: 200,
    description: 'Estimate range',
    type: EstimateResponseDto,
  })
  estimate(@Body() dto: EstimateRequestDto): EstimateResponse {
    return this.valuationService.estimate(dto);
  }
}
