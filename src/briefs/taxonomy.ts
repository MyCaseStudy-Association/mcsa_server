/**
 * Buyer-category taxonomy — STARTER v0.2 (tracker §5.4; counsel ratification
 * pending). Referenced by consent receipts (`buyer_categories`), briefs
 * (`categoryId`) and sale records. VERSIONED and APPEND-ONLY: a receipt
 * signed against a version must stay interpretable forever, so ids are
 * never re-used or re-defined — add a new id and bump the version instead.
 *
 * Pure: no Nest imports.
 */
export const BUYER_CATEGORY_TAXONOMY_VERSION = '0.2';

export const BUYER_CATEGORIES = [
  { id: 'ai_lab_commercial', label: 'Commercial AI developer' },
  { id: 'ai_research_nonprofit', label: 'Nonprofit AI research organisation' },
  { id: 'academic', label: 'Academic / university research' },
  {
    id: 'enterprise_internal',
    label: 'Company training models for internal use',
  },
  // ED decision (12 Aug 2026): included, conditional on R-14 flow-down contracts.
  { id: 'data_broker_reseller', label: 'Data platform / licensed reseller' },
] as const;

export type BuyerCategoryId = (typeof BUYER_CATEGORIES)[number]['id'];

export function isBuyerCategoryId(value: string): value is BuyerCategoryId {
  return BUYER_CATEGORIES.some((category) => category.id === value);
}

export function buyerCategoryLabel(id: BuyerCategoryId): string {
  return BUYER_CATEGORIES.find((category) => category.id === id)?.label ?? id;
}
