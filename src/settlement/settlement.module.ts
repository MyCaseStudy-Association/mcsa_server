import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';
import { SettlementWorker } from './settlement.worker';
@Module({
  imports: [PrismaModule, JwtModule.register({})],
  controllers: [SettlementController],
  providers: [SettlementService, SettlementWorker, JwtAuthGuard],
})
export class SettlementModule {}
