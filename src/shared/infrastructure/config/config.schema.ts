import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MinLength,
  validateSync,
} from 'class-validator';

const url = { require_tld: false };

export class AppConfig {
  @Type(() => Number)
  @IsInt()
  PORT: number = 3001;

  @IsUrl({ ...url, protocols: ['postgres', 'postgresql'] })
  DATABASE_URL!: string;

  @IsUrl(url)
  HACIENDA_IDP_URL!: string; // realm rut-stag or rut

  @IsIn(['api-stag', 'api-prod'])
  HACIENDA_CLIENT_ID!: 'api-stag' | 'api-prod';

  @IsUrl(url)
  HACIENDA_RECEPTION_URL!: string; // sandbox or production

  @Transform(({ value }: { value: unknown }) =>
    value === '' ? undefined : value,
  )
  @IsOptional()
  @IsUrl(url)
  HACIENDA_CALLBACK_URL?: string;

  @IsUrl(url)
  HACIENDA_PUBLIC_API_URL!: string;

  @Matches(/^\d{9,12}$/)
  SOFTWARE_PROVIDER_ID!: string;

  @Matches(/^[0-9a-f]{64}$/i, { message: 'must be 64 hex characters' })
  CERT_ENCRYPTION_KEY!: string; // AES-256-GCM

  @IsString()
  @MinLength(32)
  WEBHOOK_SECRET!: string;

  @IsString()
  @MinLength(32)
  ADMIN_API_KEY!: string;
}

export function validateConfig(raw: Record<string, unknown>): AppConfig {
  const config = plainToInstance(AppConfig, raw);
  const errors = validateSync(config);
  if (errors.length) {
    const issues = errors
      .flatMap((e) =>
        Object.values(e.constraints ?? {}).map((m) => `${e.property}: ${m}`),
      )
      .join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return config;
}
