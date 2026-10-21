import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { fetchWithTimeout } from '../common/http';

export interface ReceptionPayload {
  clave: string;
  fecha: string;
  emisor: { tipoIdentificacion: string; numeroIdentificacion: string };
  receptor?: { tipoIdentificacion: string; numeroIdentificacion: string };
  callbackUrl?: string;
  comprobanteXml: string; // base64
}

export type SubmitResult =
  | { kind: 'received' }
  /** Hacienda refused the submission itself (4xx); not ambiguous. */
  | { kind: 'refused'; status: number; cause: string }
  | { kind: 'unauthorized' }
  /** Timeout, network error or 5xx: it may or may not have arrived. */
  | { kind: 'ambiguous'; reason: string };

export type HaciendaState =
  'recibido' | 'procesando' | 'aceptado' | 'rechazado' | 'error';

export type StatusResult =
  | { kind: 'found'; state: HaciendaState; responseXml?: string }
  | { kind: 'not_found' }
  | { kind: 'unauthorized' }
  | { kind: 'unavailable'; reason: string };

@Injectable()
export class HaciendaReceptionClient {
  constructor(private readonly config: AppConfigService) {}

  async submit(
    token: string,
    payload: ReceptionPayload,
  ): Promise<SubmitResult> {
    let res: Response;
    try {
      res = await fetchWithTimeout(this.url('/recepcion'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      return { kind: 'ambiguous', reason: describe(err) };
    }

    // 202 means "received", not "accepted".
    if (res.status === 201 || res.status === 202) return { kind: 'received' };
    if (res.status === 401 || res.status === 403)
      return { kind: 'unauthorized' };
    if (res.status >= 500 || res.status === 429) {
      return { kind: 'ambiguous', reason: `HTTP ${res.status}` };
    }
    return {
      kind: 'refused',
      status: res.status,
      cause:
        res.headers.get('x-error-cause') ?? (await res.text()).slice(0, 500),
    };
  }

  async status(token: string, key: string): Promise<StatusResult> {
    let res: Response;
    try {
      res = await fetchWithTimeout(this.url(`/recepcion/${key}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      return { kind: 'unavailable', reason: describe(err) };
    }

    if (res.status === 404) return { kind: 'not_found' };
    if (res.status === 401 || res.status === 403)
      return { kind: 'unauthorized' };
    if (!res.ok) return { kind: 'unavailable', reason: `HTTP ${res.status}` };

    const body = (await res.json()) as {
      'ind-estado'?: string;
      'respuesta-xml'?: string;
    };
    const state = body['ind-estado']?.toLowerCase() as
      HaciendaState | undefined;
    if (!state)
      return { kind: 'unavailable', reason: 'No ind-estado in response' };
    return {
      kind: 'found',
      state,
      responseXml: body['respuesta-xml']
        ? Buffer.from(body['respuesta-xml'], 'base64').toString('utf8')
        : undefined,
    };
  }

  private url(path: string) {
    return `${this.config.get('HACIENDA_RECEPTION_URL').replace(/\/$/, '')}${path}`;
  }
}

function describe(err: unknown): string {
  if (err instanceof Error && err.name === 'TimeoutError') return 'timeout';
  return err instanceof Error ? err.message : String(err);
}
