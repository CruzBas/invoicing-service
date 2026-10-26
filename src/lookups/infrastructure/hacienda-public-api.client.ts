import { Injectable } from '@nestjs/common';
import { UpstreamError } from '../../shared/application/errors';
import { AppConfigService } from '../../shared/infrastructure/config/app-config.service';
import { fetchWithTimeout } from '../../shared/infrastructure/http';

export interface CabysItem {
  code: string;
  description: string;
  tax: number;
}

interface RawCabys {
  codigo: string;
  descripcion: string;
  impuesto: number;
}


@Injectable()
export class HaciendaPublicApiClient {
  constructor(private readonly config: AppConfigService) { }


  async taxpayer(identification: string): Promise<unknown> {
    const res = await this.get(`/fe/ae?identificacion=${identification}`);
    if (res.status === 404) return null;
    return this.json(res);
  }

  async cabys(query: string): Promise<CabysItem[]> {
    const path = /^\d+$/.test(query)
      ? `/fe/cabys?codigo=${query}`
      : `/fe/cabys?q=${encodeURIComponent(query)}&top=10`;
    const body = (await this.json(await this.get(path))) as
      { cabys?: RawCabys[] } | RawCabys[];
    const items = Array.isArray(body) ? body : (body.cabys ?? []);
    return items.map((i) => ({
      code: i.codigo,
      description: i.descripcion,
      tax: i.impuesto,
    }));
  }


  async usdSellingRate(): Promise<number | undefined> {
    const body = (await this.json(await this.get('/indicadores/tc/dolar'))) as {
      venta?: { fecha?: string; valor?: number };
    };
    return body.venta?.valor;
  }

  private async get(path: string): Promise<Response> {
    try {
      return await fetchWithTimeout(
        `${this.config.get('HACIENDA_PUBLIC_API_URL')}${path}`,
        { headers: { Accept: 'application/json' } },
      );
    } catch {
      throw new UpstreamError('Hacienda public API did not respond');
    }
  }

  private async json(res: Response): Promise<unknown> {
    if (!res.ok) {
      throw new UpstreamError(`Hacienda public API returned ${res.status}`);
    }
    return res.json();
  }
}
