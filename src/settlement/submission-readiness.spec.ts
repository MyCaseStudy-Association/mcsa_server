import { submissionReadiness } from './submission-readiness';
describe('shared submission readiness', () => {
  const brief = {
    status: 'live',
    expiresAt: new Date(Date.now() + 86400000),
    escrowCommitted: true,
    payment: { status: 'paid', paymentIntentId: 'pi' },
  };
  it('accepts verified active funding', () =>
    expect(submissionReadiness(100, brief)).toBeNull());
  it('blocks legacy seed funding without a payment', () =>
    expect(submissionReadiness(100, { ...brief, payment: null })).toContain(
      'funding',
    ));
  it('blocks expired briefs', () =>
    expect(
      submissionReadiness(100, { ...brief, expiresAt: new Date(0) }),
    ).toContain('expired'));
  it('blocks paused briefs', () =>
    expect(submissionReadiness(100, { ...brief, status: 'paused' })).toContain(
      'not active',
    ));
  it('blocks refunded payments', () =>
    expect(
      submissionReadiness(100, {
        ...brief,
        payment: { status: 'refunded', paymentIntentId: 'pi' },
      }),
    ).toContain('funding'));
});
