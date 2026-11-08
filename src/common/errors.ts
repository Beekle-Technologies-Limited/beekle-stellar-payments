import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'unknown error';
}

export function isDuplicateKey(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as {
    code?: string;
    errno?: number;
    driverError?: { code?: string; errno?: number };
  };
  const code = candidate.driverError?.code ?? candidate.code;
  const errno = candidate.driverError?.errno ?? candidate.errno;
  return code === 'ER_DUP_ENTRY' || errno === 1062;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      let message = exception.message;
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body && 'message' in body) {
        const raw = (body as { message?: string | string[] }).message;
        message = Array.isArray(raw) ? raw.join('; ') : (raw ?? message);
      }
      response.status(status).json({
        error: { code: statusName(status), message },
      });
      return;
    }
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'internal_error', message: 'Internal error' },
    });
  }
}

function statusName(status: number): string {
  if (status === 400) return 'bad_request';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 503) return 'unavailable';
  return 'http_error';
}
