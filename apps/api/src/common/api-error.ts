import { HttpException, HttpStatus } from '@nestjs/common';

// Error answers carry a stable machine-readable `code` next to Nest's usual fields, so the app
// can react (e.g. resay_pending → open that lesson) without parsing messages. Messages never
// carry internal detail (EXC-01).

const REASONS: Partial<Record<number, string>> = {
  400: 'Bad Request',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

export class ApiError extends HttpException {
  constructor(
    status: HttpStatus,
    code: string,
    message: string,
    extra: Record<string, unknown> = {},
  ) {
    super(
      {
        statusCode: status,
        error: REASONS[status] ?? 'Error',
        code,
        message,
        ...extra,
      },
      status,
    );
  }
}
