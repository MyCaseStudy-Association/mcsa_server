type FundingBrief = {
  status: string;
  expiresAt: Date;
  escrowCommitted: boolean;
  payment: { status: string; paymentIntentId: string | null } | null;
};
export function submissionReadiness(
  amountCents: number | null,
  brief?: FundingBrief,
): string | null {
  if (!amountCents || amountCents < 1) return 'No payable valuation';
  if (
    !brief?.payment?.paymentIntentId ||
    brief.payment.status !== 'paid' ||
    !brief.escrowCommitted
  )
    return 'Waiting for verified buyer funding';
  if (brief.expiresAt <= new Date()) return 'Matched brief has expired';
  if (brief.status !== 'live') return 'Matched brief is not active';
  return null;
}
