import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { logger } from '@codeer/logger';

@Catch()
export class SecureExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const requestId = response.locals.requestId as string | undefined;
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const knownResponse = exception instanceof HttpException ? exception.getResponse() : undefined;

    if (status >= 500) {
      logger.error(
        {
          requestId,
          method: request.method,
          path: request.originalUrl,
          status,
          exception:
            exception instanceof Error
              ? { name: exception.name, message: exception.message, stack: exception.stack }
              : { value: String(exception) },
        },
        'Unhandled API exception',
      );
    } else {
      logger.warn(
        { requestId, method: request.method, path: request.originalUrl, status },
        'API request rejected',
      );
    }

    const safeBody =
      status >= 500
        ? {
            statusCode: status,
            error: 'Internal Server Error',
            message: 'The request could not be completed.',
            requestId,
          }
        : typeof knownResponse === 'string'
          ? { statusCode: status, message: knownResponse, requestId }
          : { ...(knownResponse as Record<string, unknown>), requestId };

    response.status(status).json(safeBody);
  }
}
