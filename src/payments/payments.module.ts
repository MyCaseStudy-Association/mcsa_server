import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
@Module({
  imports: [PrismaModule, JwtModule.register({})],
  controllers: [PaymentsController],
  providers: [PaymentsService, JwtAuthGuard],
})
export class PaymentsModule {}
