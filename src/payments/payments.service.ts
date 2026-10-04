import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentsService {
  private readonly stripe: Stripe | null;
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const key = config.get<string>('STRIPE_SECRET_KEY');
    this.stripe = key
      ? new Stripe(key, { maxNetworkRetries: 2, timeout: 15000 })
      : null;
  }
  private client(): Stripe {
    if (!this.stripe || !this.config.get<string>('STRIPE_WEBHOOK_SECRET'))
      throw new ServiceUnavailableException(
        'Stripe payments are not configured yet.',
      );
    return this.stripe;
  }
  private webOrigin(): string {
    const value = this.config.get<string>('WEB_APP_URL');
    if (!value)
      throw new ServiceUnavailableException(
        'Payment return URL is not configured.',
      );
    const url = new URL(value);
    if (
      url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname)
      )
    )
      throw new ServiceUnavailableException(
        'Payment return URL must use HTTPS.',
      );
    return url.origin;
  }
  async quote(
    userId: string,
    briefRef: string,
    amountCents: number,
  ): Promise<{ amountCents: number }> {
    if (
      !Number.isSafeInteger(amountCents) ||
      amountCents < 50 ||
      amountCents > 99999999
    )
      throw new BadRequestException('Enter a valid USD amount.');
    return this.prisma.$transaction(
      async (tx) => {
        if (
          (await tx.user.findUnique({ where: { id: userId } }))?.role !==
          'admin'
        )
          throw new ForbiddenException();
        const brief = await tx.brief.findUnique({
          where: { briefRef },
          include: { payment: true },
        });
        if (!brief) throw new NotFoundException('Brief not found.');
        if (
          brief.payment ||
          brief.escrowCommitted ||
          !['draft', 'paused'].includes(brief.status) ||
          brief.expiresAt <= new Date()
        )
          throw new ConflictException(
            'Quote is locked or this brief is closed.',
          );
        await tx.brief.update({
          where: { id: brief.id },
          data: { fundingAmountCents: amountCents },
        });
        return { amountCents };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async checkout(userId: string, briefRef: string): Promise<{ url: string }> {
    const stripe = this.client();
    const origin = this.webOrigin();
    // Freeze the server quote and reserve one payment per brief before contacting Stripe.
    let payment = await this.prisma.$transaction(
      async (tx) => {
        const brief = await tx.brief.findUnique({
          where: { briefRef },
          include: { buyer: { include: { user: true } }, payment: true },
        });
        if (
          !brief ||
          brief.buyer.userId !== userId ||
          brief.buyer.user?.role !== 'buyer'
        )
          throw new NotFoundException('Brief not found.');
        if (
          brief.escrowCommitted ||
          !['draft', 'paused'].includes(brief.status) ||
          brief.expiresAt <= new Date()
        )
          throw new ConflictException(
            'This brief is already funded or closed.',
          );
        if (brief.currency !== 'USD')
          throw new BadRequestException('Only USD funding is supported.');
        if (!brief.fundingAmountCents)
          throw new ConflictException(
            'A moderator must set a funding quote first.',
          );
        if (brief.payment) return brief.payment;
        return tx.briefPayment.create({
          data: {
            briefId: brief.id,
            amountCents: brief.fundingAmountCents,
            currency: 'usd',
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (payment.status === 'failed') {
      const reset = await this.prisma.briefPayment.updateMany({
        where: { id: payment.id, status: 'failed', attempt: payment.attempt },
        data: { status: 'pending', attempt: { increment: 1 }, sessionId: null },
      });
      if (!reset.count)
        throw new ConflictException('Checkout changed. Please try again.');
      payment = await this.prisma.briefPayment.findUniqueOrThrow({
        where: { id: payment.id },
      });
    }
    if (payment.status !== 'pending')
      throw new ConflictException('This payment requires moderator review.');
    if (payment.sessionId) {
      const session = await stripe.checkout.sessions.retrieve(
        payment.sessionId,
      );
      if (session.status === 'open' && session.url) return { url: session.url };
      if (session.status !== 'expired')
        throw new ConflictException(
          'Payment is processing. Refresh shortly for confirmation.',
        );
      const changed = await this.prisma.briefPayment.updateMany({
        where: {
          id: payment.id,
          attempt: payment.attempt,
          status: 'pending',
          sessionId: payment.sessionId,
        },
        data: { sessionId: null, attempt: { increment: 1 } },
      });
      if (!changed.count)
        throw new ConflictException('Checkout changed. Please try again.');
      payment = await this.prisma.briefPayment.findUniqueOrThrow({
        where: { id: payment.id },
      });
    }
    // Stripe may prune idempotency keys after 24h. If a crash lost the session id,
    // do not risk creating another charge after that recovery window.
    if (
      !payment.sessionId &&
      Date.now() - payment.updatedAt.getTime() > 23 * 60 * 60 * 1000
    ) {
      throw new ConflictException(
        'Checkout recovery requires moderator review in Stripe.',
      );
    }
    // Same payment+attempt always has the same Stripe parameters and idempotency key.
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        client_reference_id: payment.id,
        metadata: { paymentId: payment.id, briefRef },
        payment_intent_data: { metadata: { paymentId: payment.id, briefRef } },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: payment.currency,
              unit_amount: payment.amountCents,
              product_data: {
                name: 'Buyer brief funding',
                description: briefRef,
              },
            },
          },
        ],
        success_url: `${origin}/dashboard/briefs?payment=success`,
        cancel_url: `${origin}/dashboard/briefs?payment=cancelled`,
      },
      { idempotencyKey: `brief-funding:${payment.id}:${payment.attempt}` },
    );
    await this.prisma.briefPayment.updateMany({
      where: { id: payment.id, attempt: payment.attempt, status: 'pending' },
      data: { sessionId: session.id },
    });
    if (!session.url)
      throw new ServiceUnavailableException(
        'Stripe did not return a checkout URL.',
      );
    return { url: session.url };
  }

  async webhook(raw: Buffer, signature: string): Promise<{ received: true }> {
    const stripe = this.client();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        raw,
        signature,
        this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET'),
      );
    } catch {
      throw new BadRequestException('Invalid Stripe signature.');
    }
    if (await this.prisma.stripeEvent.findUnique({ where: { id: event.id } }))
      return { received: true };
    let paymentId: string | undefined;
    let intent: Stripe.PaymentIntent | undefined;
    let outcome: 'paid' | 'refunded' | 'disputed' | 'failed' | undefined;
    let sessionId: string | undefined;
    if (
      [
        'checkout.session.completed',
        'checkout.session.async_payment_succeeded',
        'checkout.session.async_payment_failed',
      ].includes(event.type)
    ) {
      const session = await stripe.checkout.sessions.retrieve(
        (event.data.object as Stripe.Checkout.Session).id,
        { expand: ['payment_intent.latest_charge'] },
      );
      paymentId = session.metadata?.paymentId;
      if (!paymentId) return { received: true }; // unrelated Stripe payment
      if (session.payment_status !== 'paid') {
        if (event.type === 'checkout.session.async_payment_failed') {
          await this.prisma.briefPayment.updateMany({
            where: { id: paymentId, status: 'pending', sessionId: session.id },
            data: { status: 'failed' },
          });
        }
        return { received: true };
      }
      sessionId = session.id;
      intent =
        typeof session.payment_intent === 'object' && session.payment_intent
          ? session.payment_intent
          : undefined;
      if (
        !intent ||
        session.currency !== intent.currency ||
        session.amount_total !== intent.amount_received ||
        session.client_reference_id !== paymentId
      )
        throw new BadRequestException('Payment verification failed.');
      const charge =
        typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
      if (!charge)
        throw new ServiceUnavailableException(
          'Stripe charge is not available yet.',
        );
      outcome = charge.disputed
        ? 'disputed'
        : charge.amount_refunded > 0
          ? 'refunded'
          : 'paid';
    } else if (
      event.type === 'charge.refunded' ||
      event.type === 'charge.dispute.created'
    ) {
      const object = event.data.object;
      const intentRef = object.payment_intent;
      if (!intentRef) return { received: true };
      intent = await stripe.paymentIntents.retrieve(
        typeof intentRef === 'string' ? intentRef : intentRef.id,
      );
      paymentId = intent.metadata.paymentId;
      outcome = event.type === 'charge.refunded' ? 'refunded' : 'disputed';
    } else return { received: true };
    if (!paymentId || !intent || !outcome) return { received: true };
    const verifiedIntent = intent;
    const verifiedOutcome = outcome;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.stripeEvent.create({
          data: { id: event.id, type: event.type },
        });
        const payment = await tx.briefPayment.findUnique({
          where: { id: paymentId },
          include: { brief: true },
        });
        if (!payment) throw new BadRequestException('Unknown brief payment.');
        if (
          verifiedIntent.metadata.paymentId !== payment.id ||
          verifiedIntent.metadata.briefRef !== payment.brief.briefRef ||
          verifiedIntent.currency !== payment.currency ||
          verifiedIntent.amount !== payment.amountCents ||
          (verifiedOutcome === 'paid' &&
            (verifiedIntent.status !== 'succeeded' ||
              verifiedIntent.amount_received !== payment.amountCents)) ||
          (payment.paymentIntentId &&
            payment.paymentIntentId !== verifiedIntent.id)
        )
          throw new BadRequestException(
            'Payment amount or identity does not match.',
          );
        if (sessionId && payment.sessionId && sessionId !== payment.sessionId)
          throw new BadRequestException('Checkout session does not match.');
        // Terminal reversals win even if a delayed success event arrives later.
        if (verifiedOutcome === 'paid') {
          const updated = await tx.briefPayment.updateMany({
            where: { id: payment.id, status: 'pending' },
            data: {
              status: 'paid',
              paymentIntentId: verifiedIntent.id,
              sessionId,
            },
          });
          if (updated.count)
            await tx.brief.update({
              where: { id: payment.briefId },
              data: {
                escrowCommitted: true,
                escrowProviderRef: verifiedIntent.id,
              },
            });
        } else {
          await tx.briefPayment.update({
            where: { id: payment.id },
            data: {
              status: verifiedOutcome,
              paymentIntentId: verifiedIntent.id,
            },
          });
          await tx.brief.update({
            where: { id: payment.briefId },
            data: { escrowCommitted: false, status: 'paused' },
          });
        }
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        (await this.prisma.stripeEvent.findUnique({ where: { id: event.id } }))
      )
        return { received: true };
      throw error;
    }
    return { received: true };
  }
}
