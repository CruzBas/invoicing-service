import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateBy,
  ValidateIf,
  ValidateNested,
  ValidationOptions,
} from 'class-validator';
import Decimal from 'decimal.js';
import { IVA_RATES } from '../domain/totals-calculator';

const CR_IDENTIFICATION_TYPES = ['01', '02', '03', '04'];

/** Accepts a string or number and turns it into a Decimal with bounded scale. */
function IsDecimal(
  opts: { maxDecimals: number; positive?: boolean },
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  const transform = Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string' && typeof value !== 'number') return value;
    try {
      return new Decimal(value);
    } catch {
      return value;
    }
  });
  const validate = ValidateBy(
    {
      name: 'isDecimal',
      validator: {
        validate: (d: unknown) =>
          d instanceof Decimal &&
          d.isFinite() &&
          !d.isNeg() &&
          !(opts.positive && d.isZero()) &&
          d.decimalPlaces() <= opts.maxDecimals,
        defaultMessage: (args) =>
          `${args?.property} must be a non-negative decimal${opts.positive ? ' greater than 0' : ''} with at most ${opts.maxDecimals} decimals`,
      },
    },
    validationOptions,
  );
  const docs = ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'number' }],
    example: '1000.00',
  });
  return (target, key) => {
    transform(target, key);
    validate(target, key);
    docs(target, key);
  };
}

const IsMoney = () => IsDecimal({ maxDecimals: 5 });

export class LineDto {
  @Matches(/^\d{13}$/)
  cabys!: string;

  @IsString()
  @Length(3, 200)
  description!: string;

  @IsDecimal({ maxDecimals: 3, positive: true })
  quantity!: Decimal;

  /** Before tax. */
  @IsMoney()
  unitPrice!: Decimal;

  @IsIn(Object.keys(IVA_RATES))
  taxRateCode!: string;

  @IsOptional()
  @IsString()
  @Length(1, 15)
  unit?: string;
}

export class ReceiverDto {
  @IsString()
  @Length(3, 100)
  name!: string;

  /** 01 física, 02 jurídica, 03 DIMEX, 04 NITE, 05 extranjero no domiciliado, 06 no contribuyente */
  @IsIn(['01', '02', '03', '04', '05', '06'])
  identificationType!: '01' | '02' | '03' | '04' | '05' | '06';

  @IsString()
  @Length(1, 20)
  @ValidateBy({
    name: 'isCostaRicanIdentification',
    validator: {
      validate: (id: unknown, args) =>
        !CR_IDENTIFICATION_TYPES.includes(
          (args?.object as ReceiverDto).identificationType,
        ) || /^\d{9,12}$/.test(String(id)),
      defaultMessage: () => 'Costa Rican identifications have 9 to 12 digits',
    },
  })
  identification!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string;

  @IsOptional()
  @IsString()
  @Length(5, 300)
  foreignAddress?: string;
}

export const PAYMENT_METHODS = [
  '01', // efectivo
  '02', // tarjeta
  '03', // cheque
  '04', // transferencia
  '05', // recaudado por terceros
  '06', // SINPE Móvil
  '07', // plataforma digital
  '99', // otros
] as const;

export class IssueDocumentDto {
  @IsString()
  @IsNotEmpty()
  emitterId!: string;

  @IsIn(['01', '04'])
  documentType!: '01' | '04';

  @IsString()
  @Length(1, 100)
  externalReference!: string;

  @IsIn(['CRC', 'USD'])
  currency!: 'CRC' | 'USD';

  @IsIn(PAYMENT_METHODS)
  paymentMethod!: (typeof PAYMENT_METHODS)[number];

  @ValidateIf(
    (b: IssueDocumentDto) =>
      b.documentType === '01' || b.receiver !== undefined,
  )
  @IsDefined({ message: 'An invoice (01) requires a receiver' })
  @ValidateNested()
  @Type(() => ReceiverDto)
  receiver?: ReceiverDto;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => LineDto)
  lines!: LineDto[];

  /** What the consumer charged; it must match what this service computes. */
  @IsMoney()
  total!: Decimal;
}

export class CreditNoteDto {
  @IsString()
  @Length(3, 180)
  reason!: string;

  /** Omitted: the whole original document is credited. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => LineDto)
  lines?: LineDto[];

  /** CodigoReferencia. Defaults: 01 (anula) when crediting everything, 04 otherwise. */
  @IsOptional()
  @IsIn(['01', '04', '06', '09', '99'])
  referenceCode?: '01' | '04' | '06' | '09' | '99';

  @IsMoney()
  total!: Decimal;
}
