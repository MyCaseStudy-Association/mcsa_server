/**
 * Stage 8 — Build #6: valuation. Stateless: no database, no persistence, no
 * logging of counts (the estimate is computed, returned and discarded). The
 * math lives in pure files (estimate.ts, precise-valuation.ts).
 */
import { Injectable } from '@nestjs/common';

import { EstimateRequestDto } from './dto/estimate-request.dto';
import { estimateRange } from './estimate';
import type { EstimateResponse } from './valuation.types';

@Injectable()
export class ValuationService {
  estimate(dto: EstimateRequestDto): EstimateResponse {
    return estimateRange(dto.conversations);
  }
}
