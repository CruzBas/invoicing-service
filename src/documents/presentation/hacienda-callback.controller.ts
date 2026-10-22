import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DocumentDeliveryService } from '../application/document-delivery.service';

/**
 * Hacienda's callbackUrl. Its content is not trusted: it only moves the next
 * poll forward, and the state is always read back from Hacienda.
 */
@ApiTags('hacienda')
@Controller('v1/hacienda/callback')
export class HaciendaCallbackController {
  constructor(private readonly delivery: DocumentDeliveryService) {}

  @Post()
  @HttpCode(200)
  async callback(@Body() body: { clave?: unknown }) {
    if (typeof body?.clave === 'string' && /^\d{50}$/.test(body.clave)) {
      await this.delivery.pollSoon(body.clave);
    }
    return {};
  }
}
