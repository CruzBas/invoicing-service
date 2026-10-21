import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { LookupsService } from './lookups.service';

@Controller('v1')
@UseGuards(ApiKeyGuard)
export class LookupsController {
  constructor(private readonly lookups: LookupsService) {}

  @Get('taxpayers/:identification')
  taxpayer(@Param('identification') identification: string) {
    return this.lookups.taxpayer(identification);
  }

  @Get('cabys')
  cabys(@Query('q') q = '') {
    return this.lookups.searchCabys(q);
  }
}
