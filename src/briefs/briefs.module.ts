import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { BriefsController } from './briefs.controller';
import { BriefsService } from './briefs.service';

@Module({
  imports: [JwtModule.register({}), PrismaModule],
  controllers: [BriefsController],
  providers: [BriefsService, JwtAuthGuard],
  exports: [BriefsService],
})
export class BriefsModule {}
