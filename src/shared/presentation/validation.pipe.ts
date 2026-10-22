import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

/** Validates DTO bodies and answers with one issue per failed constraint. */
export const appValidationPipe = () =>
  new ValidationPipe({
    transform: true,
    whitelist: true,
    exceptionFactory: (errors) =>
      new BadRequestException({
        message: 'Validation failed',
        issues: flatten(errors),
      }),
  });

function flatten(
  errors: ValidationError[],
  parent = '',
): { path: string; message: string }[] {
  return errors.flatMap((e) => {
    const path = parent ? `${parent}.${e.property}` : e.property;
    return [
      ...Object.values(e.constraints ?? {}).map((message) => ({
        path,
        message,
      })),
      ...flatten(e.children ?? [], path),
    ];
  });
}
