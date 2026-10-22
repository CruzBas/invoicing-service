import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { DateTime } from 'luxon';
import {
  InvalidInputError,
  NotFoundError,
  UpstreamError,
} from '../../shared/application/errors';
import { COSTA_RICA_ZONE } from '../../shared/domain/costa-rica';
import {
  CabysItem,
  HaciendaPublicApiClient,
} from '../infrastructure/hacienda-public-api.client';
import { TtlCache } from '../infrastructure/ttl-cache';

const HOUR = 3_600_000;

/** Taxpayers, CABYS and the exchange rate, cached in memory. */
@Injectable()
export class LookupsService {
  private readonly taxpayers = new TtlCache<unknown>(HOUR);
  private readonly cabys = new TtlCache<CabysItem[]>(24 * HOUR);
  private readonly rates = new TtlCache<Decimal>(24 * HOUR, 10);

  constructor(private readonly hacienda: HaciendaPublicApiClient) {}

  taxpayer(identification: string): Promise<unknown> {
    const id = identification.replace(/\D/g, '');
    if (id.length < 9 || id.length > 12) {
      throw new InvalidInputError('Identification must have 9 to 12 digits');
    }
    return this.taxpayers.getOrLoad(id, async () => {
      const taxpayer = await this.hacienda.taxpayer(id);
      if (taxpayer === null) throw new NotFoundError('Taxpayer not found');
      return taxpayer;
    });
  }

  searchCabys(query: string): Promise<CabysItem[]> {
    const q = query.trim();
    if (q.length < 3) {
      throw new InvalidInputError('The query needs at least 3 characters');
    }
    return this.cabys.getOrLoad(q.toLowerCase(), () => this.hacienda.cabys(q));
  }

  /** BCCR selling rate for today (Costa Rica's calendar day). */
  usdExchangeRate(): Promise<Decimal> {
    const today = DateTime.now().setZone(COSTA_RICA_ZONE).toISODate()!;
    return this.rates.getOrLoad(today, async () => {
      const value = await this.hacienda.usdSellingRate();
      if (!value || value <= 0) {
        throw new UpstreamError('Exchange rate unavailable');
      }
      return new Decimal(value);
    });
  }
}
