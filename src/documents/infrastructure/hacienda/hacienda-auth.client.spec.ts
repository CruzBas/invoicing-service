import { AppConfigService } from '../../../shared/infrastructure/config/app-config.service';
import { fetchWithTimeout } from '../../../shared/infrastructure/http';
import { HaciendaAuthClient, HaciendaAuthError } from './hacienda-auth.client';

jest.mock('../../../shared/infrastructure/http');
const fetchMock = jest.mocked(fetchWithTimeout);

const config = { get: () => 'x' } as unknown as AppConfigService;
const creds = { apiUser: 'user', apiPassword: 'wrong' };

const rejected = () =>
  new Response(
    JSON.stringify({
      error: 'invalid_grant',
      error_description: 'Invalid user credentials',
    }),
    { status: 401 },
  );
const granted = () =>
  new Response(JSON.stringify({ access_token: 'token', expires_in: 300 }));

describe('HaciendaAuthClient', () => {
  beforeEach(() => fetchMock.mockReset());

  it('reports the IDP error description', async () => {
    fetchMock.mockResolvedValueOnce(rejected());
    await expect(
      new HaciendaAuthClient(config).token('e1', creds),
    ).rejects.toThrow(
      'Hacienda IDP returned 401 (invalid_grant: Invalid user credentials)',
    );
  });

  it('does not retry rejected credentials until the backoff ends', async () => {
    const auth = new HaciendaAuthClient(config);
    fetchMock.mockResolvedValueOnce(rejected());
    const first = await auth.token('e1', creds).catch((e: unknown) => e);
    expect(first).toBeInstanceOf(HaciendaAuthError);
    expect((first as HaciendaAuthError).retryAt.getTime()).toBeGreaterThan(
      Date.now(),
    );

    await expect(auth.token('e1', creds)).rejects.toBeInstanceOf(
      HaciendaAuthError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tries new credentials at once', async () => {
    const auth = new HaciendaAuthClient(config);
    fetchMock
      .mockResolvedValueOnce(rejected())
      .mockResolvedValueOnce(granted());
    await auth.token('e1', creds).catch(() => undefined);

    await expect(
      auth.token('e1', { ...creds, apiPassword: 'right' }),
    ).resolves.toBe('token');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
