import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { fundBalances } from './fund-balances';

@Injectable()
export class SettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}
  enabled(): boolean {
    return this.config.get<string>('SETTLEMENT_ENABLED') === 'true';
  }
  private stripe(): Stripe {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!key || !this.enabled())
      throw new ServiceUnavailableException(
        'Fund distribution is not enabled. Configure Stripe Connect and SETTLEMENT_ENABLED first.',
      );
    return new Stripe(key, { maxNetworkRetries: 2, timeout: 15000 });
  }
  private async role(userId: string, role?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || (role && user.role !== role)) throw new ForbiddenException();
    return user;
  }
  private async lock(tx: Prisma.TransactionClient, paymentId: string) {
    // All reservations, transfer claims and refunds serialize on this funding row.
    return tx.briefPayment.update({
      where: { id: paymentId },
      data: { updatedAt: new Date() },
      include: { brief: true },
    });
  }
  private async balances(
    tx: Prisma.TransactionClient,
    paymentId: string,
    cents: number,
  ) {
    const allocations = await tx.fundAllocation.findMany({
      where: { paymentId },
    });
    const refund = await tx.fundRefund.findUnique({ where: { paymentId } });
    return fundBalances(cents, allocations, refund);
  }
  private async entry(
    tx: Prisma.TransactionClient,
    paymentId: string,
    eventKey: string,
    kind: string,
    amountCents: number,
    reference?: string,
  ) {
    await tx.fundLedgerEntry.upsert({
      where: { eventKey },
      create: { paymentId, eventKey, kind, amountCents, reference },
      update: {},
    });
  }
  private checkRecovery(date: Date) {
    if (Date.now() - date.getTime() > 23 * 60 * 60 * 1000)
      throw new ConflictException(
        'Operation requires reconciliation in Stripe: the safe automatic retry window has elapsed.',
      );
  }
  private async charge(payment: {
    paymentIntentId: string | null;
    amountCents: number;
    currency: string;
  }) {
    if (!payment.paymentIntentId)
      throw new ConflictException(
        'Verified Stripe funding is required. Seed funding cannot be distributed.',
      );
    const intent = await this.stripe().paymentIntents.retrieve(
      payment.paymentIntentId,
      { expand: ['latest_charge'] },
    );
    const charge =
      typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
    if (
      !charge ||
      intent.status !== 'succeeded' ||
      intent.amount_received !== payment.amountCents ||
      intent.currency !== payment.currency
    )
      throw new ConflictException('Stripe funding could not be verified.');
    return charge;
  }

  async onboard(userId: string, country: string): Promise<{ url: string }> {
    const user = await this.role(userId, 'user');
    const stripe = this.stripe();
    const allowed = (this.config.get<string>('STRIPE_CONNECT_COUNTRIES') || '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    if (!allowed.includes(country))
      throw new BadRequestException(
        'This payout country has not been enabled by the platform.',
      );
    const origin = new URL(this.config.getOrThrow<string>('WEB_APP_URL'));
    if (
      origin.protocol !== 'https:' &&
      !(
        origin.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(origin.hostname)
      )
    )
      throw new ServiceUnavailableException('Invalid web application URL.');
    let row = await this.prisma.contributorAccount.upsert({
      where: { userId },
      create: { userId, country },
      update: {},
    });
    if (row.country !== country)
      throw new ConflictException(
        'Payout country is locked to the existing connected account.',
      );
    if (!row.stripeAccountId) {
      this.checkRecovery(row.createdAt);
      const account = await stripe.v2.core.accounts.create(
        {
          contact_email: user.email,
          identity: { country },
          dashboard: 'express',
          defaults: {
            responsibilities: {
              fees_collector: 'application',
              losses_collector: 'application',
            },
          },
          configuration: {
            recipient: {
              capabilities: {
                stripe_balance: { stripe_transfers: { requested: true } },
              },
            },
          },
          metadata: { contributorRef: row.id },
        },
        { idempotencyKey: `connect-v2:${row.id}` },
      );
      row = await this.prisma.contributorAccount.update({
        where: { id: row.id },
        data: { stripeAccountId: account.id },
      });
    }
    const link = await stripe.v2.core.accountLinks.create({
      account: row.stripeAccountId!,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          refresh_url: `${origin.origin}/dashboard/funds?connect=refresh`,
          return_url: `${origin.origin}/dashboard/funds?connect=return`,
        },
      },
    });
    return { url: link.url };
  }
  async payoutDashboard(userId: string): Promise<{ url: string }> {
    await this.role(userId, 'user');
    const account = await this.prisma.contributorAccount.findUnique({
      where: { userId },
    });
    if (!account?.stripeAccountId)
      throw new ConflictException('Connect a payout account first.');
    const link = await this.stripe().accounts.createLoginLink(
      account.stripeAccountId,
    );
    return { url: link.url };
  }
  async account(userId: string) {
    await this.role(userId, 'user');
    const row = await this.prisma.contributorAccount.findUnique({
      where: { userId },
    });
    if (!row?.stripeAccountId)
      return {
        status: 'not_connected',
        country: row?.country ?? null,
        payoutsEnabled: false,
      };
    const account = await this.stripe().accounts.retrieve(row.stripeAccountId);
    return {
      status:
        account.capabilities?.transfers === 'active' && account.payouts_enabled
          ? 'ready'
          : 'onboarding_required',
      country: row.country,
      connected: true,
      transfersEnabled: account.capabilities?.transfers === 'active',
      requirementsDue: account.requirements?.currently_due ?? [],
      pendingVerification: account.requirements?.pending_verification ?? [],
      payoutsEnabled: account.payouts_enabled,
    };
  }
  async dashboard(userId: string) {
    const user = await this.role(userId);
    const countries = (
      this.config.get<string>('STRIPE_CONNECT_COUNTRIES') || ''
    )
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    if (user.role === 'user') {
      const allocations = await this.prisma.fundAllocation.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, amountCents: true, status: true, createdAt: true },
      });
      const totals = await this.prisma.fundAllocation.groupBy({
        by: ['status'],
        where: { userId },
        _sum: { amountCents: true },
      });
      let connect = {
        status: 'unavailable',
        country: null as string | null,
        payoutsEnabled: false,
      };
      if (this.enabled()) {
        try {
          connect = await this.account(userId);
        } catch {
          /* Show unavailable, never imply readiness. */
        }
      }
      return {
        role: user.role,
        enabled: this.enabled(),
        countries,
        connect,
        allocations,
        totals: totals.map((t) => ({
          status: t.status,
          amountCents: t._sum.amountCents ?? 0,
        })),
        funds: [],
        candidates: [],
      };
    }
    const payments = await this.prisma.briefPayment.findMany({
      where: user.role === 'admin' ? {} : { brief: { buyer: { userId } } },
      include: {
        brief: {
          select: {
            briefRef: true,
            status: true,
            expiresAt: true,
            buyer: { select: { legalName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const funds = await Promise.all(
      payments.map(async (p) => {
        const allocations = await this.prisma.fundAllocation.findMany({
          where: { paymentId: p.id },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            amountCents: true,
            status: true,
            createdAt: true,
          },
        });
        const refund = await this.prisma.fundRefund.findUnique({
          where: { paymentId: p.id },
        });
        const refundSnapshot = await this.prisma.fundLedgerEntry.findFirst({
          where: { paymentId: p.id, kind: 'funding_review' },
          orderBy: { amountCents: 'desc' },
          select: { amountCents: true },
        });
        const entries = await this.prisma.fundLedgerEntry.findMany({
          where: { paymentId: p.id },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { id: true, kind: true, amountCents: true, createdAt: true },
        });
        return {
          id: p.id,
          briefRef: p.brief.briefRef,
          buyer: p.brief.buyer.legalName,
          status: p.status,
          expiresAt: p.brief.expiresAt,
          balances: {
            ...fundBalances(
              p.paymentIntentId ? p.amountCents : 0,
              allocations,
              refund,
            ),
            refundedCents: Math.max(
              refund?.status === 'succeeded' ? refund.amountCents : 0,
              refundSnapshot?.amountCents ?? 0,
            ),
            ...(['refunded', 'disputed'].includes(p.status)
              ? { availableCents: 0 }
              : {}),
          },
          allocations,
          refund: refund
            ? { status: refund.status, amountCents: refund.amountCents }
            : null,
          entries,
        };
      }),
    );
    const candidates =
      user.role === 'admin'
        ? await this.prisma.qaResult.findMany({
            where: {
              status: 'passed',
              amountCents: { gt: 0 },
              briefId: {
                in: payments
                  .filter(
                    (p) =>
                      p.status === 'paid' &&
                      p.brief.status === 'live' &&
                      p.brief.expiresAt > new Date(),
                  )
                  .map((p) => p.briefId),
              },
            },
            select: { id: true, briefId: true, amountCents: true },
            take: 100,
            orderBy: { createdAt: 'asc' },
          })
        : [];
    const existing = await this.prisma.fundAllocation.findMany({
      where: { qaId: { in: candidates.map((q) => q.id) } },
      select: { qaId: true },
    });
    return {
      role: user.role,
      enabled: this.enabled(),
      countries,
      connect: null,
      allocations: [],
      totals: [],
      funds,
      candidates: candidates
        .filter((q) => !existing.some((a) => a.qaId === q.id))
        .map((q) => ({
          id: q.id,
          amountCents: q.amountCents,
          briefRef: payments.find((p) => p.briefId === q.briefId)?.brief
            .briefRef,
        })),
    };
  }
  async reserve(userId: string, qaId: string): Promise<{ id: string }> {
    await this.role(userId, 'admin');
    return this.prisma.$transaction(
      async (tx) => {
        const qa = await tx.qaResult.findUnique({ where: { id: qaId } });
        if (
          !qa ||
          qa.status !== 'passed' ||
          !qa.packagedRecordRef ||
          !qa.amountCents ||
          qa.amountCents < 1
        )
          throw new ConflictException(
            'A current QA pass with a positive valuation is required.',
          );
        const source = await tx.briefPayment.findUnique({
          where: { briefId: qa.briefId },
        });
        if (!source)
          throw new ConflictException(
            'No Stripe funding exists for this brief.',
          );
        const payment = await this.lock(tx, source.id);
        if (
          payment.status !== 'paid' ||
          !payment.paymentIntentId ||
          !payment.brief.escrowCommitted ||
          payment.brief.status !== 'live' ||
          payment.brief.expiresAt <= new Date()
        )
          throw new ConflictException(
            'Brief must be live, funded and unexpired.',
          );
        const existing = await tx.fundAllocation.findUnique({
          where: { qaId },
        });
        if (existing) return { id: existing.id };
        const record = await tx.packagedRecord.findUnique({
          where: { recordRef: qa.packagedRecordRef },
        });
        const receipt =
          record &&
          (await tx.consentReceipt.findUnique({
            where: { receiptRef: record.consentReceiptRef },
          }));
        if (
          !record ||
          record.userId !== qa.userId ||
          record.status !== 'available' ||
          qa.packagedChainHash !== record.chainHash ||
          !receipt ||
          receipt.revokedAt
        )
          throw new ConflictException(
            'Contribution is unavailable or consent has been withdrawn.',
          );
        const volume = payment.brief.volume as {
          targetConversations: number;
          maxPerContributor?: number | null;
        };
        const count = await tx.fundAllocation.count({
          where: {
            paymentId: payment.id,
            status: { notIn: ['cancelled', 'reversed'] },
          },
        });
        const ownCount = await tx.fundAllocation.count({
          where: {
            paymentId: payment.id,
            userId: qa.userId,
            status: { notIn: ['cancelled', 'reversed'] },
          },
        });
        if (
          count >= volume.targetConversations ||
          (volume.maxPerContributor && ownCount >= volume.maxPerContributor)
        )
          throw new ConflictException('Brief collection limit reached.');
        const balances = await this.balances(
          tx,
          payment.id,
          payment.amountCents,
        );
        if (balances.availableCents < qa.amountCents)
          throw new ConflictException('Insufficient unallocated funding.');
        const allocation = await tx.fundAllocation.create({
          data: {
            paymentId: payment.id,
            qaId: qa.id,
            userId: qa.userId,
            recordRef: record.recordRef,
            activeRecordRef: record.recordRef,
            chainHash: record.chainHash,
            amountCents: qa.amountCents,
          },
        });
        await this.entry(
          tx,
          payment.id,
          `funding:${payment.id}`,
          'funded',
          payment.amountCents,
          payment.paymentIntentId,
        );
        await this.entry(
          tx,
          payment.id,
          `reserve:${allocation.id}`,
          'reserved',
          allocation.amountCents,
          allocation.id,
        );
        return { id: allocation.id };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async cancel(userId: string, id: string): Promise<{ cancelled: boolean }> {
    await this.role(userId, 'admin');
    return this.prisma.$transaction(async (tx) => {
      const allocation = await tx.fundAllocation.findUniqueOrThrow({
        where: { id },
      });
      await this.lock(tx, allocation.paymentId);
      const updated = await tx.fundAllocation.updateMany({
        where: { id, status: 'reserved' },
        data: { status: 'cancelled', activeRecordRef: null },
      });
      if (!updated.count)
        throw new ConflictException(
          'Only unreleased reservations can be cancelled.',
        );
      await this.entry(
        tx,
        allocation.paymentId,
        `cancel:${id}`,
        'reservation_cancelled',
        allocation.amountCents,
        id,
      );
      return { cancelled: true };
    });
  }
  async release(userId: string, id: string): Promise<{ status: string }> {
    await this.role(userId, 'admin');
    const stripe = this.stripe();
    let allocation = await this.prisma.fundAllocation.findUniqueOrThrow({
      where: { id },
    });
    if (allocation.status === 'transferred') return { status: 'transferred' };
    const payment = await this.prisma.briefPayment.findUniqueOrThrow({
      where: { id: allocation.paymentId },
    });
    const charge = await this.charge(payment);
    if (charge.disputed || charge.amount_refunded > 0)
      throw new ConflictException(
        'Refunded or disputed funding cannot be released.',
      );
    const connected = await this.prisma.contributorAccount.findUnique({
      where: { userId: allocation.userId },
    });
    if (!connected?.stripeAccountId)
      throw new ConflictException(
        'Contributor must connect a payout account first.',
      );
    const account = await stripe.accounts.retrieve(connected.stripeAccountId);
    if (
      account.capabilities?.transfers !== 'active' ||
      !account.payouts_enabled
    )
      throw new ConflictException(
        'Contributor Stripe onboarding is incomplete.',
      );
    allocation = await this.prisma.$transaction(
      async (tx) => {
        const locked = await this.lock(tx, payment.id);
        const current = await tx.fundAllocation.findUniqueOrThrow({
          where: { id },
        });
        if (current.status === 'transferring') return current;
        if (
          current.status !== 'reserved' ||
          locked.status !== 'paid' ||
          !locked.brief.escrowCommitted ||
          locked.brief.status !== 'live' ||
          locked.brief.expiresAt <= new Date()
        )
          throw new ConflictException(
            'Allocation or brief is not eligible for release.',
          );
        const qa = await tx.qaResult.findUniqueOrThrow({
          where: { id: current.qaId },
        });
        const record = await tx.packagedRecord.findUniqueOrThrow({
          where: { recordRef: current.recordRef },
        });
        const receipt = await tx.consentReceipt.findUnique({
          where: { receiptRef: record.consentReceiptRef },
        });
        if (
          qa.status !== 'passed' ||
          qa.amountCents !== current.amountCents ||
          qa.packagedChainHash !== current.chainHash ||
          record.chainHash !== current.chainHash ||
          record.status !== 'available' ||
          !receipt ||
          receipt.revokedAt
        )
          throw new ConflictException(
            'Quality or consent changed. Cancel this reservation and review the contribution.',
          );
        // Freeze the sale at approval; uncertain Stripe outcomes keep the funds reserved.
        await tx.packagedRecord.update({
          where: { id: record.id },
          data: { status: 'sold' },
        });
        return tx.fundAllocation.update({
          where: { id },
          data: {
            status: 'transferring',
            approvedBy: userId,
            startedAt: new Date(),
            destination: account.id,
            sourceCharge: charge.id,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (allocation.status !== 'transferring')
      throw new ConflictException('Allocation is already being processed.');
    this.checkRecovery(allocation.startedAt!);
    const transfer = await stripe.transfers.create(
      {
        amount: allocation.amountCents,
        currency: payment.currency,
        destination: allocation.destination!,
        source_transaction: allocation.sourceCharge!,
        transfer_group: `brief_${payment.id}`,
        metadata: { allocationId: id },
      },
      { idempotencyKey: `allocation:${id}` },
    );
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, payment.id);
      const updated = await tx.fundAllocation.updateMany({
        where: { id, status: 'transferring' },
        data: { status: 'transferred', transferId: transfer.id },
      });
      if (updated.count)
        await this.entry(
          tx,
          payment.id,
          `transfer:${id}`,
          'transferred',
          allocation.amountCents,
          transfer.id,
        );
    });
    return { status: 'transferred' };
  }

  async expire(paymentId: string): Promise<void> {
    const stripe = this.stripe();
    const source = await this.prisma.briefPayment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { brief: true },
    });
    if (source.brief.expiresAt > new Date() || !source.paymentIntentId) return;
    const charge = await this.charge(source);
    const existingRefund = await this.prisma.fundRefund.findUnique({
      where: { paymentId },
    });
    if (charge.disputed || (charge.amount_refunded > 0 && !existingRefund))
      return;
    const refund = await this.prisma.$transaction(
      async (tx) => {
        const payment = await this.lock(tx, paymentId);
        const existing = await tx.fundRefund.findUnique({
          where: { paymentId },
        });
        if (existing) return existing;
        if (payment.status !== 'paid') return null;
        // Stop new matching before returning any unused money.
        await tx.brief.update({
          where: { id: payment.briefId },
          data: { status: 'expired', escrowCommitted: false },
        });
        const reservations = await tx.fundAllocation.findMany({
          where: { paymentId, status: 'reserved' },
        });
        for (const allocation of reservations) {
          await tx.fundAllocation.update({
            where: { id: allocation.id },
            data: { status: 'cancelled', activeRecordRef: null },
          });
          await this.entry(
            tx,
            paymentId,
            `cancel:${allocation.id}`,
            'reservation_cancelled',
            allocation.amountCents,
            allocation.id,
          );
        }
        const unsettled = await tx.fundAllocation.count({
          where: {
            paymentId,
            status: { in: ['transferring', 'review', 'reversing'] },
          },
        });
        if (unsettled) return null;
        const balance = await this.balances(tx, paymentId, payment.amountCents);
        if (balance.availableCents <= 0) return null;
        await this.entry(
          tx,
          paymentId,
          `funding:${paymentId}`,
          'funded',
          payment.amountCents,
          payment.paymentIntentId!,
        );
        const refund = await tx.fundRefund.create({
          data: { paymentId, amountCents: balance.availableCents },
        });
        await this.entry(
          tx,
          paymentId,
          `refund-request:${refund.id}`,
          'refund_requested',
          refund.amountCents,
          refund.id,
        );
        return refund;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (!refund || !['pending'].includes(refund.status)) return;
    let stripeRefund: Stripe.Refund;
    if (refund.stripeRefundId)
      stripeRefund = await stripe.refunds.retrieve(refund.stripeRefundId);
    else {
      this.checkRecovery(refund.createdAt);
      stripeRefund = await stripe.refunds.create(
        {
          payment_intent: source.paymentIntentId,
          amount: refund.amountCents,
          metadata: { fundRefundId: refund.id },
        },
        { idempotencyKey: `unused-refund:${refund.id}` },
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, paymentId);
      const status =
        stripeRefund.status === 'succeeded'
          ? 'succeeded'
          : ['failed', 'canceled'].includes(stripeRefund.status ?? '')
            ? 'review'
            : 'pending';
      await tx.fundRefund.update({
        where: { id: refund.id },
        data: { stripeRefundId: stripeRefund.id, status },
      });
      if (status === 'succeeded')
        await this.entry(
          tx,
          paymentId,
          `refund:${refund.id}`,
          'refunded',
          refund.amountCents,
          stripeRefund.id,
        );
    });
  }

  async reconcile(paymentId: string): Promise<void> {
    const payment = await this.prisma.briefPayment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    const uncertain = await this.prisma.fundAllocation.findMany({
      where: { paymentId, status: 'transferring' },
    });
    for (const allocation of uncertain) {
      for await (const transfer of this.stripe().transfers.list({
        transfer_group: `brief_${paymentId}`,
        limit: 100,
      })) {
        if (transfer.metadata.allocationId !== allocation.id) continue;
        if (
          transfer.amount !== allocation.amountCents ||
          transfer.destination !== allocation.destination
        )
          throw new ConflictException('Transfer reconciliation mismatch.');
        await this.prisma.$transaction(async (tx) => {
          await this.lock(tx, paymentId);
          await tx.fundAllocation.updateMany({
            where: { id: allocation.id, status: 'transferring' },
            data: { status: 'transferred', transferId: transfer.id },
          });
          await this.entry(
            tx,
            paymentId,
            `transfer:${allocation.id}`,
            'transferred',
            allocation.amountCents,
            transfer.id,
          );
        });
        break;
      }
    }
    const charge = await this.charge(payment);
    let ownRefund = await this.prisma.fundRefund.findUnique({
      where: { paymentId },
    });
    if (ownRefund && !ownRefund.stripeRefundId && charge.amount_refunded > 0) {
      for await (const refund of this.stripe().refunds.list({
        payment_intent: payment.paymentIntentId!,
        limit: 100,
      })) {
        if (
          refund.metadata?.fundRefundId === ownRefund.id &&
          refund.amount === ownRefund.amountCents
        ) {
          ownRefund = await this.prisma.fundRefund.update({
            where: { id: ownRefund.id },
            data: { stripeRefundId: refund.id },
          });
          break;
        }
      }
    }
    // An expiry refund only returns unallocated funds; external refunds/disputes freeze all settlements.
    if (!charge.disputed && charge.amount_refunded === 0) return;
    if (!charge.disputed && ownRefund?.stripeRefundId) {
      const refund = await this.stripe().refunds.retrieve(
        ownRefund.stripeRefundId,
      );
      if (
        refund.status === 'succeeded' &&
        charge.amount_refunded === refund.amount
      )
        return;
    }
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, paymentId);
      await tx.brief.update({
        where: { id: payment.briefId },
        data: { escrowCommitted: false, status: 'paused' },
      });
      const reserved = await tx.fundAllocation.findMany({
        where: { paymentId, status: 'reserved' },
      });
      for (const a of reserved) {
        await tx.fundAllocation.update({
          where: { id: a.id },
          data: { status: 'cancelled', activeRecordRef: null },
        });
        await this.entry(
          tx,
          paymentId,
          `cancel:${a.id}`,
          'reservation_cancelled',
          a.amountCents,
          a.id,
        );
      }
      await this.entry(
        tx,
        paymentId,
        `review:${charge.id}:${charge.amount_refunded}:${charge.disputed}`,
        'funding_review',
        charge.amount_refunded,
        charge.id,
      );
    });
    // Do not assume a refund automatically reverses Connect transfers.
    const allocations = await this.prisma.fundAllocation.findMany({
      where: { paymentId, status: { in: ['transferred', 'reversing'] } },
    });
    for (const a of allocations) {
      if (!a.transferId) continue;
      const transfer = await this.stripe().transfers.retrieve(a.transferId);
      if (transfer.amount_reversed !== a.amountCents) {
        if (transfer.amount_reversed > 0)
          throw new ConflictException(
            'Partially reversed transfer requires manual reconciliation.',
          );
        if (a.status === 'transferred')
          await this.prisma.fundAllocation.update({
            where: { id: a.id },
            data: { status: 'reversing', startedAt: new Date() },
          });
        else this.checkRecovery(a.startedAt!);
        await this.stripe().transfers.createReversal(
          a.transferId,
          { amount: a.amountCents, metadata: { allocationId: a.id } },
          { idempotencyKey: `reverse:${a.id}` },
        );
      }
      await this.prisma.$transaction(async (tx) => {
        await this.lock(tx, paymentId);
        await tx.fundAllocation.update({
          where: { id: a.id },
          data: { status: 'reversed' },
        });
        await this.entry(
          tx,
          paymentId,
          `reverse:${a.id}`,
          'transfer_reversed',
          a.amountCents,
          a.transferId!,
        );
      });
    }
  }
}
