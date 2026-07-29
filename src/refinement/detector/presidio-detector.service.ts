/**
 * Presidio-backed detector (OD-03). Runs as an isolated sidecar service —
 * see docker-compose.presidio.yml — so the de-id detector stays its own
 * swappable unit (TEE-portable later, D-05). Data never leaves our zone:
 * the analyzer is self-hosted; no cloud DLP call ever.
 *
 * Any transport or analyzer error is thrown to the caller, which FAILS
 * CLOSED (records excluded) — never fails open.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DetectedSpan, Detector } from '../refinement.types';

type PresidioResult = {
  entity_type: string;
  start: number;
  end: number;
  score: number;
};

const PRESIDIO_TYPE_MAP: Record<string, string> = {
  EMAIL_ADDRESS: 'EMAIL',
  PHONE_NUMBER: 'PHONE',
  US_SSN: 'GOV_ID',
  US_ITIN: 'GOV_ID',
  US_PASSPORT: 'GOV_ID',
  US_DRIVER_LICENSE: 'GOV_ID',
  CREDIT_CARD: 'ACCOUNT',
  IBAN_CODE: 'ACCOUNT',
  US_BANK_NUMBER: 'ACCOUNT',
  CRYPTO: 'ACCOUNT',
  IP_ADDRESS: 'IP',
  URL: 'URL',
  MEDICAL_LICENSE: 'MEDICAL_LICENSE',
  PERSON: 'PERSON',
  LOCATION: 'GPE',
  DATE_TIME: 'DATE',
  NRP: 'NORP',
  ORGANIZATION: 'ORG',
};

@Injectable()
export class PresidioDetectorService implements Detector {
  readonly id = 'presidio';
  readonly version: string;
  private readonly baseUrl: string;

  constructor(configService: ConfigService) {
    this.baseUrl =
      configService.get<string>('PRESIDIO_URL') ?? 'http://localhost:5002';
    this.version = configService.get<string>('PRESIDIO_VERSION') ?? 'unknown';
  }

  async analyze(text: string): Promise<DetectedSpan[]> {
    const response = await fetch(`${this.baseUrl}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language: 'en' }),
    });

    if (!response.ok) {
      throw new Error(`Presidio analyzer returned ${response.status}`);
    }

    const results = (await response.json()) as PresidioResult[];
    return results.map((result) => ({
      // Unmapped Presidio labels stay as-is and fail closed downstream
      // (group H: REDACT + log).
      type: PRESIDIO_TYPE_MAP[result.entity_type] ?? result.entity_type,
      start: result.start,
      end: result.end,
      text: text.slice(result.start, result.end),
      confidence: result.score,
    }));
  }
}
