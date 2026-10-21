import {
  Body,
  Controller,
  NotFoundException,
  Param,
  Post,
  Put,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AdminKeyGuard } from '../auth/admin-key.guard';
import { generateApiKey, hashApiKey } from '../auth/api-key';
import { ADMIN_KEY, ApiZodBody } from '../common/openapi';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

const clientBodySchema = z.object({
  webhookUrl: z.string().url().nullish(),
  emitterIds: z.array(z.string().min(1)).min(1),
});
const createClientSchema = clientBodySchema.extend({
  name: z.string().min(2).max(60),
});
type ClientBody = z.infer<typeof clientBodySchema>;
type CreateClientBody = z.infer<typeof createClientSchema>;

/** Consumers of the service (cotizadores, nora). Admin key only. */
@ApiTags('admin')
@ApiSecurity(ADMIN_KEY)
@Controller('v1/clients')
@UseGuards(AdminKeyGuard)
export class ClientsController {
  constructor(private readonly prisma: PrismaService) {}

  /** The key is returned once; only its hash is stored. */
  @Post()
  @ApiZodBody(createClientSchema)
  async create(
    @Body(new ZodValidationPipe(createClientSchema)) body: CreateClientBody,
  ) {
    await this.assertEmittersExist(body.emitterIds);
    const apiKey = generateApiKey();
    const client = await this.prisma.apiClient.create({
      data: {
        name: body.name,
        keyHash: hashApiKey(apiKey),
        webhookUrl: body.webhookUrl ?? null,
        emitters: {
          create: body.emitterIds.map((emitterId) => ({ emitterId })),
        },
      },
    });
    return { id: client.id, name: client.name, apiKey };
  }

  @Put(':id')
  @ApiZodBody(clientBodySchema)
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(clientBodySchema)) body: ClientBody,
  ) {
    await this.assertEmittersExist(body.emitterIds);
    const exists = await this.prisma.apiClient.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException();
    await this.prisma.$transaction([
      this.prisma.apiClientEmitter.deleteMany({ where: { clientId: id } }),
      this.prisma.apiClient.update({
        where: { id },
        data: {
          webhookUrl: body.webhookUrl ?? null,
          emitters: {
            create: body.emitterIds.map((emitterId) => ({ emitterId })),
          },
        },
      }),
    ]);
    return {
      id,
      webhookUrl: body.webhookUrl ?? null,
      emitterIds: body.emitterIds,
    };
  }

  private async assertEmittersExist(ids: string[]) {
    const found = await this.prisma.emitter.count({
      where: { id: { in: ids } },
    });
    if (found !== new Set(ids).size) {
      throw new UnprocessableEntityException('Unknown emitter id');
    }
  }
}
