import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { BriefsModule } from './briefs/briefs.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { RefinementModule } from './refinement/refinement.module';
import { UsersModule } from './users/users.module';
import { ValuationModule } from './valuation/valuation.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    UsersModule,
    AuthModule,
    RefinementModule,
    BriefsModule,
    ValuationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
