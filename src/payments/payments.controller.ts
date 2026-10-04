import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { QuoteBriefDto } from './dto/quote-brief.dto';
import { PaymentsService } from './payments.service';
@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}
  @Post('briefs/:briefRef/quote')
  @UseGuards(JwtAuthGuard)
  @Roles('admin')
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Set USD funding quote before buyer checkout begins',
  })
  @ApiResponse({ status: 200, description: 'Quote saved' })
  quote(
    @Req() req: AuthenticatedRequest,
    @Param('briefRef') ref: string,
    @Body() dto: QuoteBriefDto,
  ) {
    return this.payments.quote(req.user.sub, ref, dto.amountCents);
  }

  @Post('briefs/:briefRef/checkout')
  @UseGuards(JwtAuthGuard)
  @Roles('buyer')
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Create or resume an owned brief Stripe Checkout session',
  })
  @ApiResponse({
    status: 200,
    description: 'Stripe-hosted checkout URL returned',
  })
  checkout(@Req() req: AuthenticatedRequest, @Param('briefRef') ref: string) {
    return this.payments.checkout(req.user.sub, ref);
  }

  // public: authenticated by Stripe signature over the raw request body
  @Post('stripe/webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive signature-verified Stripe funding events' })
  @ApiResponse({ status: 200, description: 'Event processed idempotently' })
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    if (!req.rawBody || !signature)
      throw new BadRequestException('Missing Stripe signature or raw body.');
    return this.payments.webhook(req.rawBody, signature);
  }
}
