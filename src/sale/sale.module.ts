import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { QaService } from './qa.service';

/**
 * Stage 8 — Build #7: the sale pipeline. Today: the QA gate only. No HTTP
 * surface: QA is driven by Stage 6 (RefinementModule) and match reports
 * (BriefsModule). Fulfilment selection, the admin window and the commitment
 * transaction land here next.
 */
@Module({
  imports: [PrismaModule],
  providers: [QaService],
  exports: [QaService],
})
export class SaleModule {}
