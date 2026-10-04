import { BuyerBriefsController } from './buyer-briefs.controller';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { SaleModule } from '../sale/sale.module';
import { BriefsController } from './briefs.controller';
import { BriefsService } from './briefs.service';

@Module({
  imports: [JwtModule.register({}), PrismaModule, SaleModule],
  controllers: [BriefsController, BuyerBriefsController],
  providers: [BriefsService, JwtAuthGuard],
  exports: [BriefsService],
})
export class BriefsModule {}
