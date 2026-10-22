import {
  IsBase64,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class EmitterDto {
  @IsIn(['01', '02', '03', '04'])
  identificationType!: '01' | '02' | '03' | '04';

  @Matches(/^\d{9,12}$/)
  identification!: string;

  @IsString()
  @Length(5, 100)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(3, 80)
  tradeName?: string | null;

  @Matches(/^\d{6}$/)
  activityCode!: string;

  @Matches(/^\d$/)
  province!: string;

  @Matches(/^\d{2}$/)
  canton!: string;

  @Matches(/^\d{2}$/)
  district!: string;

  @IsString()
  @Length(5, 250)
  otherSigns!: string;

  @IsEmail()
  @MaxLength(160)
  email!: string;

  @Matches(/^\d{3}$/)
  branchCode: string = '001';

  @Matches(/^\d{5}$/)
  terminalCode: string = '00001';
}

export class CertificateDto {
  @IsBase64()
  @IsNotEmpty()
  certificateBase64!: string;

  @IsString()
  @IsNotEmpty()
  pin!: string;

  @IsString()
  @IsNotEmpty()
  apiUser!: string;

  @IsString()
  @IsNotEmpty()
  apiPassword!: string;
}
