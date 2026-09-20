import { BadRequestException } from '@nestjs/common';
import { BriefsService } from './briefs.service';
import type { PushableBrief } from './briefs.types';
import { isPushable, toDevicePayload } from './push-payload';
import {
  BUYER_CATEGORIES,
  BUYER_CATEGORY_TAXONOMY_VERSION,
  isBuyerCategoryId,
} from './taxonomy';
import type { PrismaService } from '../prisma/prisma.service';

const future = new Date(Date.now() + 86_400_000);

function brief(overrides: Partial<PushableBrief> = {}): PushableBrief {
  return {
    briefRef: 'brief_test',
    status: 'live',
    escrowCommitted: true,
    expiresAt: future,
    spec: {
      domains: ['coding'],
      languages: ['en'],
      keywordsAny: ['debug'],
      keywordsAll: [],
      keywordsNone: [],
      minPromptsPerConversation: 2,
    },
    quality: { maxRedactionDensity: 0.15, dedupGuarantee: 'exact+near' },
    buyer: { categoryId: 'ai_lab_commercial' },
    ...overrides,
  };
}

describe('taxonomy', () => {
  it('has the five ratified ids and a version', () => {
    expect(BUYER_CATEGORIES.map((c) => c.id)).toEqual([
      'ai_lab_commercial',
      'ai_research_nonprofit',
      'academic',
      'enterprise_internal',
      'data_broker_reseller',
    ]);
    expect(BUYER_CATEGORY_TAXONOMY_VERSION).toBe('0.2');
    expect(isBuyerCategoryId('model_developer')).toBe(false); // the old, unratified id
  });
});

describe('device push payload (INV-8 boundary)', () => {
  it('pushes only live, escrow-committed, unexpired briefs (D-16)', () => {
    const now = new Date();
    expect(isPushable(brief(), now)).toBe(true);
    expect(isPushable(brief({ status: 'draft' }), now)).toBe(false);
    expect(isPushable(brief({ status: 'paused' }), now)).toBe(false);
    expect(isPushable(brief({ escrowCommitted: false }), now)).toBe(false);
    expect(isPushable(brief({ expiresAt: new Date(0) }), now)).toBe(false);
  });

  it('never carries buyer identity, price, volume or escrow state', () => {
    const payload = toDevicePayload([brief()]);
    expect(payload.briefs).toHaveLength(1);
    const pushed = payload.briefs[0] as unknown as Record<string, unknown>;
    expect(Object.keys(pushed).sort()).toEqual(
      ['briefRef', 'categoryId', 'quality', 'spec'].sort(),
    );
    expect(Object.keys(pushed.quality as object)).toEqual([
      'maxRedactionDensity',
    ]);
    const serialised = JSON.stringify(payload);
    for (const forbidden of [
      'legalName',
      'buyerRef',
      'volume',
      'pricing',
      'escrow',
      'dedupGuarantee',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});

describe('BriefsService.goLive (D-16 gate)', () => {
  function serviceWith(escrowCommitted: boolean) {
    const update = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      brief: {
        findUnique: jest.fn().mockResolvedValue({ escrowCommitted }),
        update,
      },
    } as unknown as PrismaService;
    return { service: new BriefsService(prisma), update };
  }

  it('refuses to go live without committed escrow', async () => {
    const { service, update } = serviceWith(false);
    await expect(service.goLive('brief_x')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('goes live once escrow is committed', async () => {
    const { service, update } = serviceWith(true);
    await service.goLive('brief_x');
    expect(update).toHaveBeenCalledWith({
      where: { briefRef: 'brief_x' },
      data: { status: 'live' },
    });
  });
});
