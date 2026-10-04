import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PaymentsService } from './payments.service';
import type { PrismaService } from '../prisma/prisma.service';

const secret = 'whsec_unit_test_only';
const brief = {
  id: 'brief-id',
  briefRef: 'brief_ref',
  currency: 'USD',
  fundingAmountCents: 2500,
  escrowCommitted: false,
  status: 'draft',
  expiresAt: new Date(Date.now() + 86400000),
  buyer: { userId: 'buyer-id', user: { role: 'buyer' } },
  payment: null,
};
const payment = {
  id: 'payment-id',
  briefId: brief.id,
  amountCents: 2500,
  currency: 'usd',
  status: 'pending',
  attempt: 1,
  updatedAt: new Date(),
  sessionId: 'cs_test',
  paymentIntentId: null,
  brief,
};
function setup() {
  const db = {
    fundLedgerEntry: { upsert: jest.fn().mockResolvedValue({}) },
    user: { findUnique: jest.fn().mockResolvedValue({ role: 'admin' }) },
    brief: {
      findUnique: jest.fn().mockResolvedValue(brief),
      update: jest.fn().mockResolvedValue(brief),
    },
    briefPayment: {
      create: jest.fn().mockResolvedValue({ ...payment, sessionId: null }),
      findUnique: jest.fn().mockResolvedValue(payment),
      findUniqueOrThrow: jest.fn().mockResolvedValue(payment),
      update: jest.fn().mockResolvedValue(payment),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    stripeEvent: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(),
  };
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) =>
    fn(db),
  );
  const service = new PaymentsService(
    db as unknown as PrismaService,
    new ConfigService({
      STRIPE_SECRET_KEY: 'sk_test_unit_only',
      STRIPE_WEBHOOK_SECRET: secret,
      WEB_APP_URL: 'http://localhost:3000',
    }),
  );
  const stripe = (service as unknown as { stripe: Stripe }).stripe;
  const intent = {
    id: 'pi_test',
    status: 'succeeded',
    currency: 'usd',
    amount: 2500,
    amount_received: 2500,
    metadata: { paymentId: payment.id, briefRef: brief.briefRef },
    latest_charge: { id: 'ch_test', amount_refunded: 0, disputed: false },
  };
  const session = {
    id: 'cs_test',
    status: 'complete',
    payment_status: 'paid',
    currency: 'usd',
    amount_total: 2500,
    client_reference_id: payment.id,
    metadata: { paymentId: payment.id },
    payment_intent: intent,
  };
  const retrieve = jest
    .spyOn(stripe.checkout.sessions, 'retrieve')
    .mockResolvedValue(
      session as unknown as Stripe.Response<Stripe.Checkout.Session>,
    );
  const create = jest
    .spyOn(stripe.checkout.sessions, 'create')
    .mockResolvedValue({
      id: 'cs_new',
      url: 'https://checkout.stripe.com/c/pay/cs_new',
    } as Stripe.Response<Stripe.Checkout.Session>);
  jest
    .spyOn(stripe.paymentIntents, 'retrieve')
    .mockResolvedValue(
      intent as unknown as Stripe.Response<Stripe.PaymentIntent>,
    );
  function webhook(type = 'checkout.session.completed') {
    const raw = JSON.stringify({
      id: 'evt_test',
      object: 'event',
      type,
      data: { object: { id: 'cs_test', payment_intent: 'pi_test' } },
    });
    return service.webhook(
      Buffer.from(raw),
      stripe.webhooks.generateTestHeaderString({ payload: raw, secret }),
    );
  }
  return { db, service, stripe, intent, session, retrieve, create, webhook };
}
describe('Stripe funding', () => {
  it('fails closed when Stripe is not configured', async () => {
    const service = new PaymentsService(
      {} as PrismaService,
      new ConfigService(),
    );
    await expect(
      service.checkout('buyer-id', 'brief_ref'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('rejects a forged webhook signature before database changes', async () => {
    const { service, db } = setup();
    await expect(
      service.webhook(Buffer.from('{}'), 'invalid'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('funds only a verified exact payment and does not activate the brief', async () => {
    const { webhook, db } = setup();
    await webhook();
    expect(db.brief.update).toHaveBeenCalledWith({
      where: { id: brief.id },
      data: { escrowCommitted: true, escrowProviderRef: 'pi_test' },
    });
  });
  it('does not fund unpaid or processing checkout', async () => {
    const { webhook, session, db } = setup();
    session.payment_status = 'unpaid';
    await webhook();
    expect(db.brief.update).not.toHaveBeenCalled();
  });
  it('rejects payment amount mismatch', async () => {
    const { webhook, intent, session, db } = setup();
    intent.amount = 500;
    intent.amount_received = 500;
    session.amount_total = 500;
    await expect(webhook()).rejects.toBeInstanceOf(BadRequestException);
    expect(db.brief.update).not.toHaveBeenCalled();
  });
  it('rejects payment identity mismatch', async () => {
    const { webhook, intent } = setup();
    intent.metadata.briefRef = 'another-brief';
    await expect(webhook()).rejects.toBeInstanceOf(BadRequestException);
  });
  it('acknowledges previously processed events without updating again', async () => {
    const { webhook, db, retrieve } = setup();
    db.stripeEvent.findUnique.mockResolvedValue({ id: 'evt_test' });
    await webhook();
    expect(retrieve).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it.each(['charge.refunded', 'charge.dispute.created'])(
    'removes funding and pauses on %s',
    async (event) => {
      const { webhook, db } = setup();
      await webhook(event);
      expect(db.brief.update).toHaveBeenCalledWith({
        where: { id: brief.id },
        data: { escrowCommitted: false, status: 'paused' },
      });
    },
  );
  it('a delayed success cannot undo a refund/dispute', async () => {
    const { webhook, db } = setup();
    db.briefPayment.updateMany.mockResolvedValue({ count: 0 });
    await webhook();
    expect(db.brief.update).not.toHaveBeenCalled();
  });
  it('uses database amount and a stable Stripe idempotency key', async () => {
    const { service, create } = setup();
    await service.checkout('buyer-id', 'brief_ref');
    const [params, options] = create.mock.calls[0];
    expect(params?.line_items?.[0]?.price_data?.unit_amount).toBe(2500);
    expect(params?.line_items?.[0]?.price_data?.currency).toBe('usd');
    expect(options?.idempotencyKey).toBe('brief-funding:payment-id:1');
  });
  it('does not recreate a lost session after the idempotency recovery window', async () => {
    const { service, db, create } = setup();
    db.briefPayment.create.mockResolvedValue({
      ...payment,
      sessionId: null,
      updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    await expect(
      service.checkout('buyer-id', 'brief_ref'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });
  it('buyer cannot pay another buyer’s brief', async () => {
    const { service, create } = setup();
    await expect(
      service.checkout('other-buyer', 'brief_ref'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(create).not.toHaveBeenCalled();
  });
  it('reuses open checkout sessions', async () => {
    const { service, db, retrieve, create } = setup();
    db.brief.findUnique.mockResolvedValue({ ...brief, payment });
    retrieve.mockResolvedValue({
      status: 'open',
      url: 'https://checkout.stripe.com/c/pay/existing',
    } as Stripe.Response<Stripe.Checkout.Session>);
    expect(await service.checkout('buyer-id', 'brief_ref')).toEqual({
      url: 'https://checkout.stripe.com/c/pay/existing',
    });
    expect(create).not.toHaveBeenCalled();
  });
  it('requires a funding quote', async () => {
    const { service, db } = setup();
    db.brief.findUnique.mockResolvedValue({
      ...brief,
      fundingAmountCents: null,
    });
    await expect(
      service.checkout('buyer-id', 'brief_ref'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('only admins can set a quote', async () => {
    const { service, db } = setup();
    db.user.findUnique.mockResolvedValue({ role: 'buyer' });
    await expect(
      service.quote('buyer-id', 'brief_ref', 500),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('quotes are frozen after checkout starts', async () => {
    const { service, db } = setup();
    db.brief.findUnique.mockResolvedValue({ ...brief, payment });
    await expect(
      service.quote('admin-id', 'brief_ref', 500),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it.each([0, -100, 0.5, 100000000])(
    'rejects invalid cents %s',
    async (amount) => {
      const { service } = setup();
      await expect(
        service.quote('admin-id', 'brief_ref', amount),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
});
