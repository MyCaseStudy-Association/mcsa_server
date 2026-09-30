import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ValuationController } from './valuation.controller';
import { ValuationService } from './valuation.service';

/** No PrismaModule: the estimate never touches the database (D2, 29 Sep). */
@Module({
  imports: [JwtModule.register({})],
  controllers: [ValuationController],
  providers: [ValuationService, JwtAuthGuard],
})
export class ValuationModule {}
