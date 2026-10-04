export type Allocation = { status: string; amountCents: number };
export function fundBalances(
  fundedCents: number,
  allocations: Allocation[],
  refund: Allocation | null,
) {
  const reservedCents = allocations
    .filter((a) => ['reserved', 'transferring', 'review'].includes(a.status))
    .reduce((n, a) => n + a.amountCents, 0);
  const transferredCents = allocations
    .filter((a) => ['transferred', 'reversing'].includes(a.status))
    .reduce((n, a) => n + a.amountCents, 0);
  const refundedCents = refund?.status === 'succeeded' ? refund.amountCents : 0;
  const refundPendingCents =
    refund && ['pending', 'review'].includes(refund.status)
      ? refund.amountCents
      : 0;
  return {
    fundedCents,
    availableCents:
      fundedCents -
      reservedCents -
      transferredCents -
      refundedCents -
      refundPendingCents,
    reservedCents,
    transferredCents,
    refundedCents,
    refundPendingCents,
  };
}
