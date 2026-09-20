/**
 * Phase-0 seed — `npx prisma db seed`.
 *
 * Creates the ONE seed buyer + brief the Phase-0 exit criterion needs
 * ("one seed brief flows through all nine stages"). Stands in for the admin
 * console (§7.9) until it exists; goes through BriefsService so the D-16
 * gate (escrow before live) applies to seeded briefs exactly as to real
 * ones. Idempotent: re-running finds the existing seed buyer and stops.
 *
 * Escrow: Phase 0 uses a sandbox reference — no real funds move (INV-5).
 */
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { BriefsService } from '../src/briefs/briefs.service';
import { PrismaService } from '../src/prisma/prisma.service';

const SEED_BUYER_LEGAL_NAME = 'Seed Buyer (Phase 0 sandbox)';

async function main() {
  const prisma = new PrismaService(new ConfigService());
  const briefs = new BriefsService(prisma);
  try {
    const existing = await prisma.buyer.findFirst({
      where: { legalName: SEED_BUYER_LEGAL_NAME },
      select: { buyerRef: true, briefs: { select: { briefRef: true } } },
    });
    if (existing) {
      console.log(
        `Seed already present: ${existing.buyerRef} with ${existing.briefs.length} brief(s). Nothing to do.`,
      );
      return;
    }

    const { buyerRef } = await briefs.createBuyer({
      legalName: SEED_BUYER_LEGAL_NAME,
      categoryId: 'ai_lab_commercial',
    });

    const { briefRef } = await briefs.createBrief({
      buyerRef,
      spec: {
        domains: ['coding', 'writing'],
        languages: ['en'],
        keywordsAny: ['debug', 'python', 'regex', 'résumé', 'draft', 'rewrite'],
        keywordsAll: [],
        keywordsNone: [],
        minPromptsPerConversation: 2,
      },
      quality: { maxRedactionDensity: 0.15, dedupGuarantee: 'exact+near' },
      volume: { targetConversations: 500, maxPerContributor: null },
      pricingScheduleVersion: '0.1',
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });

    // D-16: escrow first, then live. Sandbox ref in Phase 0.
    await briefs.commitEscrow(briefRef, 'sandbox:seed');
    await briefs.goLive(briefRef);

    console.log(`Seeded buyer ${buyerRef} and LIVE brief ${briefRef}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
