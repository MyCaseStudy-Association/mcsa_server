import { fundBalances } from './fund-balances';
describe('fund conservation', () => {
  it('separates reservations, transfers and refunds without double spending', () => {
    expect(
      fundBalances(
        1000,
        [
          { status: 'reserved', amountCents: 100 },
          { status: 'transferring', amountCents: 200 },
          { status: 'transferred', amountCents: 300 },
          { status: 'cancelled', amountCents: 999 },
        ],
        { status: 'pending', amountCents: 400 },
      ),
    ).toEqual({
      fundedCents: 1000,
      availableCents: 0,
      reservedCents: 300,
      transferredCents: 300,
      refundedCents: 0,
      refundPendingCents: 400,
    });
  });
  it('holds uncertain refunds instead of making money spendable', () => {
    expect(
      fundBalances(100, [], { status: 'review', amountCents: 100 })
        .availableCents,
    ).toBe(0);
  });
  it('keeps reversing transfers out of available funds', () => {
    expect(
      fundBalances(100, [{ status: 'reversing', amountCents: 100 }], null)
        .availableCents,
    ).toBe(0);
  });
  it('returns reversed funds to the internal balance for reconciliation', () => {
    expect(
      fundBalances(100, [{ status: 'reversed', amountCents: 100 }], null)
        .availableCents,
    ).toBe(100);
  });
  it('records completed refunds separately', () => {
    expect(
      fundBalances(100, [], { status: 'succeeded', amountCents: 100 })
        .refundedCents,
    ).toBe(100);
  });
});
