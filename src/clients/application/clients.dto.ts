import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MinLength,
} from 'class-validator';

export class ClientDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  webhookUrl?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  emitterIds!: string[];
}

export class CreateClientDto extends ClientDto {
  @IsString()
  @Length(2, 60)
  name!: string;
}
