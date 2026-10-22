/** Body of the error response: a message, or an object with extra fields. */
export type ErrorDetails =
  string | { message: string; [field: string]: unknown };

/**
 * Errors raised by use cases. They know nothing about HTTP; AppErrorFilter
 * maps each kind to its status code.
 */
export abstract class AppError extends Error {
  constructor(readonly details?: ErrorDetails) {
    super(typeof details === 'object' ? details.message : details);
  }
}

/** The input breaks a rule that the request schema cannot express. */
export class InvalidInputError extends AppError {}
export class ForbiddenError extends AppError {}
export class NotFoundError extends AppError {}
/** The resource is in a state that does not allow the operation (yet). */
export class ConflictError extends AppError {}
/** Well-formed input that the business rules reject. */
export class UnprocessableError extends AppError {}
/** An external service failed or did not answer. */
export class UpstreamError extends AppError {}
