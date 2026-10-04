import type { PrismaService } from '../prisma/prisma.service';
import { QaService } from './qa.service';

const NOW = new Date('2026-10-03T12:00:00Z');

/** The `create` payload of the first qaResult.upsert call. */
const written = (upsert: jest.Mock): Record<string, unknown> =>
  (upsert.mock.calls[0] as [{ create: Record<string, unknown> }])[0].create;

function setup(
  overrides: {
    record?: Record<string, unknown> | null;
    revokedAt?: Date | null;
    briefStatus?: string;
    others?: { exactHash: string; simHash: string; createdAt: Date }[];
  } = {},
) {
  const upsert = jest.fn().mockResolvedValue({});
  const kept = ['a'.repeat(64), 'b'.repeat(64)];
  const record =
    overrides.record === undefined
      ? {
          recordRef: 'rec_1',
          status: 'available',
          consentReceiptRef: 'rcpt_1',
          language: 'en',
          domainTags: ['coding'],
          prompts: [
            'help me debug this python function',
            'it fails on an empty list',
          ],
        }
      : overrides.record;
  const prisma = {
    briefMatch: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'match_1',
          brief: {
            id: 'brief_id_1',
            briefRef: 'brief_1',
            status: overrides.briefStatus ?? 'live',
            escrowCommitted: true,
            expiresAt: new Date('2027-01-01T00:00:00Z'),
            spec: {
              domains: ['coding'],
              languages: ['en'],
              keywordsAny: ['debug'],
              keywordsAll: [],
              keywordsNone: [],
              minPromptsPerConversation: 2,
            },
            quality: {
              maxRedactionDensity: 0.15,
              dedupGuarantee: 'exact+near',
            },
            buyer: { categoryId: 'ai_lab_commercial' },
          },
        },
      ]),
    },
    packagedRecord: { findUnique: jest.fn().mockResolvedValue(record) },
    consentReceipt: {
      findUnique: jest.fn().mockResolvedValue({
        revokedAt: overrides.revokedAt ?? null,
        payload: {
          scope: { conversation_fingerprints: kept },
          authorisation: { buyer_categories: ['ai_lab_commercial'] },
          jurisdiction: 'US',
        },
      }),
    },
    recordFingerprint: {
      findMany: jest
        .fn()
        // own rows, then other contributors' rows
        .mockResolvedValueOnce(
          kept.map((exactHash, i) => ({
            exactHash,
            simHash: i === 0 ? '0000000000000000' : 'ffffffffffffffff',
            createdAt: new Date('2026-10-01T00:00:00Z'),
          })),
        )
        .mockResolvedValueOnce(overrides.others ?? []),
    },
    qaResult: { upsert },
  } as unknown as PrismaService;
  return { service: new QaService(prisma), upsert };
}

describe('QaService.runForConversation', () => {
  it('persists a pass with the precise valuation, metadata only', async () => {
    const { service, upsert } = setup();
    await expect(
      service.runForConversation('user_1', 'conv_1', NOW),
    ).resolves.toEqual({ evaluated: 1, passed: 1 });

    const create = written(upsert);
    expect(create).toMatchObject({
      briefMatchId: 'match_1',
      status: 'passed',
      failures: [],
      dedupStatus: 'new',
      tierCounts: { short: 2, medium: 0, long: 0 },
      passedAt: NOW,
    });
    expect(typeof create.amountCents).toBe('number');
    // INV-1: no prompt text anywhere in what is written.
    expect(JSON.stringify(create)).not.toContain('python');
  });

  it('fails on a revoked receipt and stores no valuation', async () => {
    const { service, upsert } = setup({ revokedAt: NOW });
    await expect(
      service.runForConversation('user_1', 'conv_1', NOW),
    ).resolves.toEqual({ evaluated: 1, passed: 0 });
    const create = written(upsert);
    expect(create.failures).toEqual(['QA_CONSENT_REVOKED']);
    expect(create.amountCents).toBeNull();
    expect(create.passedAt).toBeNull();
  });

  it('flags a conversation another contributor submitted first', async () => {
    const earlier = new Date('2026-09-01T00:00:00Z');
    const { service, upsert } = setup({
      others: [
        { exactHash: 'a'.repeat(64), simHash: '0', createdAt: earlier },
        { exactHash: 'b'.repeat(64), simHash: '0', createdAt: earlier },
      ],
    });
    await service.runForConversation('user_1', 'conv_1', NOW);
    const create = written(upsert);
    expect(create.dedupStatus).toBe('exact_duplicate');
    expect(create.failures).toEqual(['QA_DUPLICATE']);
  });

  it('records a not-yet-packaged match as failed', async () => {
    const { service, upsert } = setup({ record: null });
    await service.runForConversation('user_1', 'conv_1', NOW);
    const create = written(upsert);
    expect(create.failures).toEqual(
      expect.arrayContaining(['QA_NOT_PACKAGED', 'QA_NO_CONSENT']),
    );
  });

  it('never re-evaluates a sold bundle (D-18)', async () => {
    const { service, upsert } = setup({
      record: { status: 'sold', recordRef: 'rec_1' },
    });
    await expect(
      service.runForConversation('user_1', 'conv_1', NOW),
    ).resolves.toEqual({ evaluated: 0, passed: 0 });
    expect(upsert).not.toHaveBeenCalled();
  });
});
