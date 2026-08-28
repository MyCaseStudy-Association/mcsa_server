import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../auth/jwt-auth.guard';
import { PackagingService } from './packaging.service';

@ApiTags('packaging')
@Controller('packaging')
export class PackagingController {
  constructor(private readonly packagingService: PackagingService) {}

  @Get('batch')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Stage 7 — assemble a delivery batch: buyer-facing JSONL records + datasheet. buyerRef scopes the conversation_id derivation.',
  })
  batch(@Query('buyerRef') buyerRef?: string) {
    return this.packagingService.buildBatch(buyerRef ?? 'buyer_test');
  }

  @Get('verify/:receiptRef')
  @ApiOperation({
    summary:
      'MVP provenance verification (F.5 (1)): buyer checks a record via consent_receipt_ref lookup. Public; returns validity only, never contributor data.',
  })
  verify(@Param('receiptRef') receiptRef: string) {
    return this.packagingService.verifyReceipt(receiptRef);
  }

  @Post('revoke/:receiptRef')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Contributor revokes consent for an UNSOLD conversation (R-01, D-18: sold is final).',
  })
  revoke(
    @Req() request: AuthenticatedRequest,
    @Param('receiptRef') receiptRef: string,
  ) {
    return this.packagingService.revoke(request.user.sub, receiptRef);
  }
}
