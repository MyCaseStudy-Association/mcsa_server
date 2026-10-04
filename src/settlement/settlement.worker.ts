import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettlementService } from './settlement.service';
@Injectable()
export class SettlementWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private cursor?: string;
  private readonly logger = new Logger(SettlementWorker.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly settlement: SettlementService,
  ) {}
  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, 60000);
    this.timer.unref();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
  async tick(): Promise<void> {
    if (this.running || !this.settlement.enabled()) return;
    this.running = true;
    try {
      const payments = await this.prisma.briefPayment.findMany({
        where: { paymentIntentId: { not: null } },
        orderBy: { id: 'asc' },
        take: 50,
        ...(this.cursor ? { cursor: { id: this.cursor }, skip: 1 } : {}),
      });
      this.cursor = payments.length === 50 ? payments[49].id : undefined;
      for (const payment of payments) {
        try {
          await this.settlement.reconcile(payment.id);
          await this.settlement.expire(payment.id);
        } catch {
          this.logger.warn(
            `Settlement requires retry or review: payment=${payment.id}`,
          );
        }
      }
    } catch {
      this.logger.warn('Settlement worker unavailable; retrying next cycle.');
    } finally {
      this.running = false;
    }
  }
}
