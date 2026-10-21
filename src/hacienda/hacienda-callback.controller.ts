import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DocumentStatus } from '../documents/domain/document-types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Hacienda's callbackUrl. Its content is not trusted: it only moves the next
 * poll forward, and the state is always read back from Hacienda.
 */
@ApiTags('hacienda')
@Controller('v1/hacienda/callback')
export class HaciendaCallbackController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @HttpCode(200)
  async callback(@Body() body: { clave?: unknown }) {
    if (typeof body?.clave === 'string' && /^\d{50}$/.test(body.clave)) {
      await this.prisma.document.updateMany({
        where: { key: body.clave, status: DocumentStatus.Sent },
        data: { nextAttemptAt: new Date() },
      });
    }
    return {};
  }
}
