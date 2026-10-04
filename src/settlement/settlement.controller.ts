import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { ConnectAccountDto } from './dto/connect-account.dto';
import { SettlementService } from './settlement.service';
@ApiTags('Fund distribution')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('settlement')
export class SettlementController {
  constructor(private readonly settlement: SettlementService) {}
  @Get('dashboard')
  @ApiOperation({
    summary: 'Role-scoped funding, earnings and ledger dashboard',
  })
  @ApiResponse({
    status: 200,
    description:
      'Financial metadata only; contributors never receive buyer details',
  })
  dashboard(@Req() req: AuthenticatedRequest) {
    return this.settlement.dashboard(req.user.sub);
  }
  @Post('connect')
  @Roles('user')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Create or resume Stripe-hosted contributor onboarding',
  })
  @ApiResponse({ status: 200, description: 'Single-use onboarding URL' })
  connect(@Req() req: AuthenticatedRequest, @Body() dto: ConnectAccountDto) {
    return this.settlement.onboard(req.user.sub, dto.country);
  }
  @Post('payout-dashboard')
  @Roles('user')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Open the contributor Stripe dashboard to view bank payouts and requirements',
  })
  @ApiResponse({ status: 200, description: 'Short-lived Stripe dashboard URL' })
  payoutDashboard(@Req() req: AuthenticatedRequest) {
    return this.settlement.payoutDashboard(req.user.sub);
  }
  @Post('reserve/:qaId')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reserve the precise QA valuation from available brief funding',
  })
  @ApiResponse({ status: 200, description: 'Idempotent allocation reference' })
  reserve(
    @Req() req: AuthenticatedRequest,
    @Param('qaId', ParseUUIDPipe) id: string,
  ) {
    return this.settlement.reserve(req.user.sub, id);
  }
  @Post('release/:id')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Approve contribution sale and transfer reserved funds to its connected account',
  })
  @ApiResponse({
    status: 200,
    description: 'Transfer status; not confirmation of bank payout',
  })
  release(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.settlement.release(req.user.sub, id);
  }
  @Post('cancel/:id')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel an unreleased reservation' })
  @ApiResponse({
    status: 200,
    description: 'Reservation returned to available funds',
  })
  cancel(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.settlement.cancel(req.user.sub, id);
  }
}
