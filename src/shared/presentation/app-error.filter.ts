import {
  ArgumentsHost,
  BadGatewayException,
  BadRequestException,
  Catch,
  ConflictException,
  ExceptionFilter,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  AppError,
  ConflictError,
  ErrorDetails,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  UnprocessableError,
  UpstreamError,
} from '../application/errors';

const HTTP_EXCEPTIONS = new Map<
  abstract new (...args: never[]) => AppError,
  new (details?: ErrorDetails) => HttpException
>([
  [InvalidInputError, BadRequestException],
  [ForbiddenError, ForbiddenException],
  [NotFoundError, NotFoundException],
  [ConflictError, ConflictException],
  [UnprocessableError, UnprocessableEntityException],
  [UpstreamError, BadGatewayException],
]);

/** Answers an AppError with the same body Nest gives its HTTP exception. */
@Catch(AppError)
export class AppErrorFilter implements ExceptionFilter {
  catch(error: AppError, host: ArgumentsHost) {
    const Exception = HTTP_EXCEPTIONS.get(error.constructor as typeof AppError);
    if (!Exception) throw error;
    const http = new Exception(error.details);
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(http.getStatus())
      .json(http.getResponse());
  }
}
