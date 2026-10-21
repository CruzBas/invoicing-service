import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { fetchWithTimeout } from '../common/http';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  refreshExpiresAt: number;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_expires_in?: number;
}

/** Renew this long before the token expires. */
const MARGIN_MS = 30_000;

export class HaciendaAuthError extends Error {}

/** OIDC token per emitter, in memory, renewed with refresh_token before it expires. */
@Injectable()
export class HaciendaAuthClient {
  private readonly tokens = new Map<string, CachedToken>();

  constructor(private readonly config: AppConfigService) {}

  async token(
    emitterId: string,
    credentials: { apiUser: string; apiPassword: string },
  ): Promise<string> {
    const now = Date.now();
    const cached = this.tokens.get(emitterId);
    if (cached && cached.expiresAt - MARGIN_MS > now) return cached.accessToken;

    if (cached?.refreshToken && cached.refreshExpiresAt - MARGIN_MS > now) {
      try {
        return this.store(
          emitterId,
          await this.request({
            grant_type: 'refresh_token',
            refresh_token: cached.refreshToken,
          }),
        );
      } catch {
        // Fall back to a password grant.
      }
    }

    return this.store(
      emitterId,
      await this.request({
        grant_type: 'password',
        username: credentials.apiUser,
        password: credentials.apiPassword,
      }),
    );
  }

  invalidate(emitterId: string) {
    this.tokens.delete(emitterId);
  }

  private store(emitterId: string, res: TokenResponse): string {
    const now = Date.now();
    this.tokens.set(emitterId, {
      accessToken: res.access_token,
      expiresAt: now + res.expires_in * 1000,
      refreshToken: res.refresh_token,
      refreshExpiresAt: now + (res.refresh_expires_in ?? 0) * 1000,
    });
    return res.access_token;
  }

  private async request(
    params: Record<string, string>,
  ): Promise<TokenResponse> {
    const body = new URLSearchParams({
      client_id: this.config.get('HACIENDA_CLIENT_ID'),
      ...params,
    });
    let res: Response;
    try {
      res = await fetchWithTimeout(this.config.get('HACIENDA_IDP_URL'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch {
      throw new HaciendaAuthError('Hacienda IDP did not respond');
    }
    if (!res.ok) {
      throw new HaciendaAuthError(`Hacienda IDP returned ${res.status}`);
    }
    return (await res.json()) as TokenResponse;
  }
}
