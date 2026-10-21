import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { DateTime } from 'luxon';
import { AppConfigService } from '../config/app-config.service';
import { fetchWithTimeout } from '../common/http';
import { COSTA_RICA_ZONE } from '../documents/domain/document-types';
import { TtlCache } from './ttl-cache';

const HOUR = 3_600_000;

export interface CabysItem {
  code: string;
  description: string;
  tax: number;
}

/** Hacienda's public endpoints. A failure is a 502, as in rule 10. */
@Injectable()
export class LookupsService {
  private readonly taxpayers = new TtlCache<unknown>(HOUR);
  private readonly cabys = new TtlCache<CabysItem[]>(24 * HOUR);
  private readonly rates = new TtlCache<Decimal>(24 * HOUR, 10);

  constructor(private readonly config: AppConfigService) {}

  taxpayer(identification: string): Promise<unknown> {
    const id = identification.replace(/\D/g, '');
    if (id.length < 9 || id.length > 12) {
      throw new BadRequestException('Identification must have 9 to 12 digits');
    }
    return this.taxpayers.getOrLoad(id, async () => {
      const res = await this.get(`/fe/ae?identificacion=${id}`);
      if (res.status === 404) throw new NotFoundException('Taxpayer not found');
      return this.json(res);
    });
  }

  searchCabys(query: string): Promise<CabysItem[]> {
    const q = query.trim();
    if (q.length < 3) {
      throw new BadRequestException('The query needs at least 3 characters');
    }
    const path = /^\d+$/.test(q)
      ? `/fe/cabys?codigo=${q}`
      : `/fe/cabys?q=${encodeURIComponent(q)}&top=10`;
    return this.cabys.getOrLoad(q.toLowerCase(), async () => {
      const body = (await this.json(await this.get(path))) as
        | {
            cabys?: { codigo: string; descripcion: string; impuesto: number }[];
          }
        | { codigo: string; descripcion: string; impuesto: number }[];
      const items = Array.isArray(body) ? body : (body.cabys ?? []);
      return items.map((i) => ({
        code: i.codigo,
        description: i.descripcion,
        tax: i.impuesto,
      }));
    });
  }

  /** BCCR selling rate for today (Costa Rica's calendar day). */
  usdExchangeRate(): Promise<Decimal> {
    const today = DateTime.now().setZone(COSTA_RICA_ZONE).toISODate()!;
    return this.rates.getOrLoad(today, async () => {
      const body = (await this.json(
        await this.get('/indicadores/tc/dolar'),
      )) as {
        venta?: { fecha?: string; valor?: number };
      };
      const value = body.venta?.valor;
      if (!value || value <= 0) {
        throw new BadGatewayException('Exchange rate unavailable');
      }
      return new Decimal(value);
    });
  }

  private async get(path: string): Promise<Response> {
    try {
      return await fetchWithTimeout(
        `${this.config.get('HACIENDA_PUBLIC_API_URL')}${path}`,
        { headers: { Accept: 'application/json' } },
      );
    } catch {
      throw new BadGatewayException('Hacienda public API did not respond');
    }
  }

  private async json(res: Response): Promise<unknown> {
    if (!res.ok) {
      throw new BadGatewayException(
        `Hacienda public API returned ${res.status}`,
      );
    }
    return res.json();
  }
}
