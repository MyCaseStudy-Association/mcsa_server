import { ConfigService } from '@nestjs/config';
import { SettlementService } from './settlement.service';
import { PrismaService } from '../prisma/prisma.service';
function setup() {
  const brief = {
    status: 'live',
    escrowCommitted: true,
    expiresAt: new Date(Date.now() + 86400000),
    volume: { targetConversations: 10, maxPerContributor: 2 },
  };
  const payment = {
    id: 'p',
    briefId: 'b',
    status: 'paid',
    paymentIntentId: 'pi',
    amountCents: 1000,
    currency: 'usd',
    brief,
  };
  const qa = {
    id: 'q',
    briefId: 'b',
    userId: 'u',
    status: 'passed',
    amountCents: 100,
    packagedRecordRef: 'r',
    packagedChainHash: 'hash',
  };
  const record = {
    id: 'r',
    recordRef: 'r',
    userId: 'u',
    status: 'available',
    chainHash: 'hash',
    consentReceiptRef: 'c',
  };
  const db = {
    user: { findUnique: jest.fn().mockResolvedValue({ role: 'admin' }) },
    qaResult: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(qa),
      findUniqueOrThrow: jest.fn().mockResolvedValue(qa),
    },
    briefPayment: {
      findUnique: jest.fn().mockResolvedValue(payment),
      findUniqueOrThrow: jest.fn().mockResolvedValue(payment),
      update: jest.fn().mockResolvedValue(payment),
    },
    fundAllocation: {
      findUnique: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'a', amountCents: 100 }),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    fundRefund: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
    packagedRecord: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(record),
      findUniqueOrThrow: jest.fn().mockResolvedValue(record),
      update: jest.fn(),
    },
    consentReceipt: {
      findUnique: jest.fn().mockResolvedValue({ revokedAt: null }),
    },
    fundLedgerEntry: { upsert: jest.fn() },
    contributorAccount: {
      upsert: jest.fn().mockResolvedValue({
        id: 'ca',
        country: 'US',
        createdAt: new Date(),
        stripeAccountId: null,
      }),
      update: jest.fn().mockResolvedValue({ stripeAccountId: 'acct' }),
      findUnique: jest.fn().mockResolvedValue({ stripeAccountId: 'acct' }),
    },
    brief: { update: jest.fn() },
    $transaction: jest.fn(),
  };
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) =>
    fn(db),
  );
  const service = new SettlementService(
    db as unknown as PrismaService,
    new ConfigService({
      SETTLEMENT_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'sk_test_fake',
      STRIPE_CONNECT_COUNTRIES: 'US',
      WEB_APP_URL: 'http://localhost:3000',
    }),
  );
  const stripe = {
    v2: {
      core: {
        accounts: { create: jest.fn().mockResolvedValue({ id: 'acct' }) },
        accountLinks: {
          create: jest
            .fn()
            .mockResolvedValue({ url: 'https://connect.stripe.com/setup' }),
        },
      },
    },
    paymentIntents: {
      retrieve: jest.fn().mockResolvedValue({
        status: 'succeeded',
        amount_received: 1000,
        currency: 'usd',
        latest_charge: { id: 'ch', disputed: false, amount_refunded: 0 },
      }),
    },
    accountLinks: {
      create: jest
        .fn()
        .mockResolvedValue({ url: 'https://connect.stripe.com/setup' }),
    },
    accounts: {
      create: jest.fn().mockResolvedValue({ id: 'acct' }),
      retrieve: jest.fn().mockResolvedValue({
        id: 'acct',
        capabilities: { transfers: 'active' },
        payouts_enabled: true,
      }),
    },
    transfers: { create: jest.fn().mockResolvedValue({ id: 'tr' }) },
    refunds: {
      create: jest.fn().mockResolvedValue({ id: 're', status: 'succeeded' }),
      retrieve: jest.fn(),
    },
  };
  jest
    .spyOn(service as unknown as { stripe: () => typeof stripe }, 'stripe')
    .mockReturnValue(stripe);
  return { service, db, brief, payment, qa, record, stripe };
}
describe('settlement authorization and accounting', () => {
  it('only admins reserve funds', async () => {
    const { service, db } = setup();
    db.user.findUnique.mockResolvedValue({ role: 'buyer' });
    await expect(service.reserve('u', 'q')).rejects.toThrow();
    expect(db.fundAllocation.create).not.toHaveBeenCalled();
  });
  it('requires a passing quality check', async () => {
    const { service, qa } = setup();
    qa.status = 'failed';
    await expect(service.reserve('u', 'q')).rejects.toThrow('QA pass');
  });
  it('does not distribute seed funding', async () => {
    const { service, payment } = setup();
    payment.paymentIntentId = '';
    await expect(service.reserve('u', 'q')).rejects.toThrow('funded');
  });
  it('rejects revoked consent', async () => {
    const { service, db } = setup();
    db.consentReceipt.findUnique.mockResolvedValue({ revokedAt: new Date() });
    await expect(service.reserve('u', 'q')).rejects.toThrow('withdrawn');
  });
  it('rejects an expired brief', async () => {
    const { service, brief } = setup();
    brief.expiresAt = new Date(0);
    await expect(service.reserve('u', 'q')).rejects.toThrow('unexpired');
  });
  it('prevents allocating more than the available funding', async () => {
    const { service, db } = setup();
    db.fundAllocation.findMany.mockResolvedValue([
      { status: 'transferred', amountCents: 950 },
    ]);
    await expect(service.reserve('u', 'q')).rejects.toThrow('Insufficient');
  });
  it('enforces the per-contributor limit', async () => {
    const { service, db } = setup();
    db.fundAllocation.count.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    await expect(service.reserve('u', 'q')).rejects.toThrow('limit');
  });
  it('reserves server valuation and creates immutable ledger events', async () => {
    const { service, db } = setup();
    await expect(service.reserve('u', 'q')).resolves.toEqual({ id: 'a' });
    expect(db.fundAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amountCents: 100, qaId: 'q' }) as unknown,
    });
    expect(db.fundLedgerEntry.upsert).toHaveBeenCalledTimes(2);
  });
  it('returns existing reservation for duplicate requests', async () => {
    const { service, db } = setup();
    db.fundAllocation.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(service.reserve('u', 'q')).resolves.toEqual({
      id: 'existing',
    });
    expect(db.fundAllocation.create).not.toHaveBeenCalled();
  });
  it('blocks releasing disputed funds before creating a transfer', async () => {
    const { service, db, stripe } = setup();
    db.fundAllocation.findUniqueOrThrow.mockResolvedValue({
      id: 'a',
      paymentId: 'p',
      userId: 'u',
      status: 'reserved',
    });
    stripe.paymentIntents.retrieve.mockResolvedValue({
      status: 'succeeded',
      amount_received: 1000,
      currency: 'usd',
      latest_charge: { id: 'ch', disputed: true, amount_refunded: 0 },
    });
    await expect(service.release('admin', 'a')).rejects.toThrow('disputed');
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });
  it('does not label an already transferred contribution as a bank payout', async () => {
    const { service, db, stripe } = setup();
    db.fundAllocation.findUniqueOrThrow.mockResolvedValue({
      status: 'transferred',
    });
    await expect(service.release('admin', 'a')).resolves.toEqual({
      status: 'transferred',
    });
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });
  it('requires completed payout onboarding', async () => {
    const { service, db } = setup();
    db.fundAllocation.findUniqueOrThrow.mockResolvedValue({
      paymentId: 'p',
      userId: 'u',
      status: 'reserved',
    });
    db.contributorAccount.findUnique.mockResolvedValue(null);
    await expect(service.release('admin', 'a')).rejects.toThrow(
      'connect a payout',
    );
  });
  it('does not refund before expiry', async () => {
    const { service, stripe } = setup();
    await service.expire('p');
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });
  it('does not refund uncertain transfers', async () => {
    const { service, brief, db, stripe } = setup();
    brief.expiresAt = new Date(0);
    db.fundAllocation.count.mockResolvedValue(1);
    await service.expire('p');
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });
  it('refunds only unused money after expiry with stable idempotency', async () => {
    const { service, brief, db, stripe } = setup();
    brief.expiresAt = new Date(0);
    db.fundAllocation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: 'transferred', amountCents: 300 }]);
    db.fundRefund.create.mockResolvedValue({
      id: 'refund',
      status: 'pending',
      amountCents: 700,
      createdAt: new Date(),
    });
    await service.expire('p');
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      {
        payment_intent: 'pi',
        amount: 700,
        metadata: { fundRefundId: 'refund' },
      },
      { idempotencyKey: 'unused-refund:refund' },
    );
  });
});

describe('Accounts v2 onboarding', () => {
  it('creates a recipient with the authenticated email and a stable key', async () => {
    const { service, db, stripe } = setup();
    db.user.findUnique.mockResolvedValue({
      role: 'user',
      email: 'person@example.com',
    });
    await expect(service.onboard('u', 'US')).resolves.toEqual({
      url: 'https://connect.stripe.com/setup',
    });
    expect(stripe.v2.core.accounts.create).toHaveBeenCalledWith(
      {
        contact_email: 'person@example.com',
        identity: { country: 'US' },
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
        metadata: { contributorRef: 'ca' },
      },
      { idempotencyKey: 'connect-v2:ca' },
    );
    expect(stripe.v2.core.accountLinks.create).toHaveBeenCalledWith({
      account: 'acct',
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          refresh_url: 'http://localhost:3000/dashboard/funds?connect=refresh',
          return_url: 'http://localhost:3000/dashboard/funds?connect=return',
        },
      },
    });
  });
  it('reuses an existing account without creating another', async () => {
    const { service, db, stripe } = setup();
    db.user.findUnique.mockResolvedValue({
      role: 'user',
      email: 'person@example.com',
    });
    db.contributorAccount.upsert.mockResolvedValue({
      id: 'ca',
      country: 'US',
      createdAt: new Date(),
      stripeAccountId: 'acct_existing',
    });
    await service.onboard('u', 'US');
    expect(stripe.v2.core.accounts.create).not.toHaveBeenCalled();
    expect(stripe.v2.core.accountLinks.create).toHaveBeenCalledWith(
      expect.objectContaining({ account: 'acct_existing' }),
    );
  });
  it('never rotates the key or saves an account after an uncertain failure', async () => {
    const { service, db, stripe } = setup();
    db.user.findUnique.mockResolvedValue({
      role: 'user',
      email: 'person@example.com',
    });
    stripe.v2.core.accounts.create.mockRejectedValue(new Error('timeout'));
    await expect(service.onboard('u', 'US')).rejects.toThrow('timeout');
    expect(stripe.v2.core.accounts.create).toHaveBeenCalledTimes(1);
    expect(db.contributorAccount.update).not.toHaveBeenCalled();
    expect(stripe.v2.core.accountLinks.create).not.toHaveBeenCalled();
  });
  it('blocks unsupported countries before calling Stripe', async () => {
    const { service, db, stripe } = setup();
    db.user.findUnique.mockResolvedValue({
      role: 'user',
      email: 'person@example.com',
    });
    await expect(service.onboard('u', 'CA')).rejects.toThrow(
      'not been enabled',
    );
    expect(stripe.v2.core.accounts.create).not.toHaveBeenCalled();
  });
});

describe('contributor submission history', () => {
  it('rejects non-contributor access', async () => {
    const { service, db } = setup();
    await expect(service.submissions('admin', 1)).rejects.toThrow();
    expect(db.packagedRecord.findMany).not.toHaveBeenCalled();
  });
  it('scopes every history query to the authenticated owner and excludes content', async () => {
    const { service, db } = setup();
    db.user.findUnique.mockResolvedValue({ role: 'user' });
    db.packagedRecord.findMany.mockResolvedValue([
      {
        recordRef: 'r',
        status: 'available',
        chainHash: 'h',
        createdAt: new Date(0),
      },
    ]);
    db.qaResult.findMany.mockResolvedValue([
      {
        packagedRecordRef: 'r',
        packagedChainHash: 'h',
        status: 'passed',
        amountCents: 100,
        allocation: null,
        briefMatch: {
          brief: {
            status: 'live',
            expiresAt: new Date(Date.now() + 86400000),
            escrowCommitted: true,
            payment: { status: 'paid', paymentIntentId: 'pi' },
          },
        },
      },
    ]);
    const result = await service.submissions('u', 1);
    expect(result.submissions[0]).toEqual({
      reference: 'r',
      submittedAt: new Date(0),
      status: 'awaiting_acceptance',
      amountCents: null,
    });
    for (const mock of [
      db.packagedRecord.findMany,
      db.qaResult.findMany,
      db.fundAllocation.findMany,
    ]) {
      expect(mock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'u' }) as unknown,
        }),
      );
    }
  });
  it('does not reuse quality results for an older version of a conversation', async () => {
    const { service, db } = setup();
    db.user.findUnique.mockResolvedValue({ role: 'user' });
    db.packagedRecord.findMany.mockResolvedValue([
      {
        recordRef: 'r',
        status: 'available',
        chainHash: 'new',
        createdAt: new Date(),
      },
    ]);
    db.qaResult.findMany.mockResolvedValue([
      { packagedRecordRef: 'r', packagedChainHash: 'old', status: 'passed' },
    ]);
    expect((await service.submissions('u', 1)).submissions[0].status).toBe(
      'awaiting_matching',
    );
  });
});

describe('submission and admin acceptance synchronization', () => {
  it('tracks the same saved record from pending acceptance through reservation and payment', async () => {
    const { service, db } = setup();
    db.packagedRecord.findMany.mockResolvedValue([
      {
        recordRef: 'r',
        status: 'available',
        chainHash: 'hash',
        createdAt: new Date(0),
      },
    ]);
    db.qaResult.findMany.mockResolvedValue([
      {
        packagedRecordRef: 'r',
        packagedChainHash: 'hash',
        status: 'passed',
        amountCents: 100,
        allocation: null,
        briefMatch: {
          brief: {
            status: 'live',
            expiresAt: new Date(Date.now() + 86400000),
            escrowCommitted: true,
            payment: { status: 'paid', paymentIntentId: 'pi' },
          },
        },
      },
    ]);
    db.user.findUnique.mockResolvedValue({ role: 'user' });
    expect((await service.submissions('u', 1)).submissions[0].status).toBe(
      'awaiting_acceptance',
    );

    db.user.findUnique.mockResolvedValue({ role: 'admin' });
    db.fundAllocation.create.mockImplementation(
      (args: { data: { recordRef: string; amountCents: number } }) => {
        const allocation = { ...args.data, id: 'a', status: 'reserved' };
        db.fundAllocation.findMany.mockResolvedValue([allocation]);
        return Promise.resolve(allocation);
      },
    );
    await service.reserve('admin', 'q');
    db.user.findUnique.mockResolvedValue({ role: 'user' });
    expect((await service.submissions('u', 1)).submissions[0]).toMatchObject({
      reference: 'r',
      status: 'reserved',
      amountCents: 100,
    });
    // Provider settlement persists these states on the same allocation.
    for (const status of [
      'transferring',
      'transferred',
      'reversing',
      'reversed',
      'cancelled',
    ]) {
      db.fundAllocation.findMany.mockResolvedValue([
        { recordRef: 'r', amountCents: 100, status },
      ]);
      expect((await service.submissions('u', 1)).submissions[0].status).toBe(
        status,
      );
    }
  });
});

describe('cross-brief duplicate acceptance', () => {
  it('blocks a conversation already allocated to another brief', async () => {
    const { service, db } = setup();
    db.fundAllocation.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'existing-other-brief' });
    await expect(service.reserve('admin', 'q')).rejects.toThrow(
      'another brief',
    );
    expect(db.fundAllocation.create).not.toHaveBeenCalled();
  });
});
