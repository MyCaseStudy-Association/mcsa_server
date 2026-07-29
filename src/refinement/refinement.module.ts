import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { MockDetectorService } from './detector/mock-detector.service';
import { PresidioDetectorService } from './detector/presidio-detector.service';
import { RefinementController } from './refinement.controller';
import { RefinementService } from './refinement.service';
import { DETECTOR } from './refinement.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * DETECTOR=presidio selects the isolated Presidio sidecar
 * (docker-compose.presidio.yml); anything else falls back to the
 * deterministic mock for local development. The policy layer is identical
 * either way — the model is swappable, the policy is not.
 */
@Module({
  imports: [JwtModule.register({}), PrismaModule],
  controllers: [RefinementController],
  providers: [
    RefinementService,
    JwtAuthGuard,
    MockDetectorService,
    PresidioDetectorService,
    {
      provide: DETECTOR,
      inject: [ConfigService, MockDetectorService, PresidioDetectorService],
      useFactory: (
        configService: ConfigService,
        mockDetector: MockDetectorService,
        presidioDetector: PresidioDetectorService,
      ) =>
        configService.get<string>('DETECTOR') === 'presidio'
          ? presidioDetector
          : mockDetector,
    },
  ],
})
export class RefinementModule {}
