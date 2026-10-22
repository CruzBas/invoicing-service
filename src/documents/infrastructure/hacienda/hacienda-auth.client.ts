import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { backoff } from '../../../shared/domain/backoff';
import { AppConfigService } from '../../../shared/infrastructure/config/app-config.service';
import { fetchWithTimeout } from '../../../shared/infrastructure/http';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  refreshExpiresAt: number;
}

interface FailedLogin {
  /** Hash of the credentials that failed; new credentials are tried at once. */
  credentials: string;
  count: number;
  retryAt: Date;
  message: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_expires_in?: number;
}

/** Renew this long before the token expires. */
const MARGIN_MS = 30_000;

export class HaciendaAuthError extends Error {
  constructor(
    message: string,
    /** No new password grant for this emitter before then. */
    readonly retryAt: Date,
  ) {
    super(message);
  }
}

class IdpError extends Error {}

/**
 * OIDC token per emitter, in memory, renewed with refresh_token before it expires.
 * Failed password grants back off per emitter, so bad credentials do not get
 * the ATV user locked out by Keycloak's brute-force protection.
 */
@Injectable()
export class HaciendaAuthClient {
  private readonly tokens = new Map<string, CachedToken>();
  private readonly failures = new Map<string, FailedLogin>();

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

    const hash = createHash('sha256')
      .update(`${credentials.apiUser}\0${credentials.apiPassword}`)
      .digest('hex');
    const failed = this.failures.get(emitterId);
    if (failed?.credentials === hash && failed.retryAt.getTime() > now) {
      throw new HaciendaAuthError(failed.message, failed.retryAt);
    }

    let res: TokenResponse;
    try {
      res = await this.request({
        grant_type: 'password',
        username: credentials.apiUser,
        password: credentials.apiPassword,
      });
    } catch (err) {
      if (!(err instanceof IdpError)) throw err;
      const count = failed?.credentials === hash ? failed.count + 1 : 1;
      const retryAt = backoff(count - 1);
      this.failures.set(emitterId, {
        credentials: hash,
        count,
        retryAt,
        message: err.message,
      });
      throw new HaciendaAuthError(err.message, retryAt);
    }
    this.failures.delete(emitterId);
    return this.store(emitterId, res);
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
      throw new IdpError('Hacienda IDP did not respond');
    }
    if (!res.ok) {
      throw new IdpError(
        `Hacienda IDP returned ${res.status}${await describeError(res)}`,
      );
    }
    return (await res.json()) as TokenResponse;
  }
}

/** Keycloak answers `{ error, error_description }`, e.g. "Invalid user credentials". */
async function describeError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as {
      error?: string;
      error_description?: string;
    };
    const detail = [body.error, body.error_description]
      .filter(Boolean)
      .join(': ');
    return detail ? ` (${detail})` : '';
  } catch {
    return '';
  }
}
