import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../clients/presentation/api-key.guard';
import { API_KEY } from '../../shared/presentation/openapi';
import { LookupsService } from '../application/lookups.service';

@ApiTags('lookups')
@ApiSecurity(API_KEY)
@Controller('v1')
@UseGuards(ApiKeyGuard)
export class LookupsController {
  constructor(private readonly lookups: LookupsService) {}

  @Get('taxpayers/:identification')
  taxpayer(@Param('identification') identification: string) {
    return this.lookups.taxpayer(identification);
  }

  @Get('cabys')
  @ApiQuery({ name: 'q', required: false })
  cabys(@Query('q') q = '') {
    return this.lookups.searchCabys(q);
  }
}
