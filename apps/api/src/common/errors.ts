export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'DELETED',
  'REBUILD_REQUIRED',
  'CURSOR_EXPIRED',
  'RATE_LIMITED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>): ApiError =>
  new ApiError(400, 'VALIDATION_ERROR', message, details);

export const unauthorized = (message = '未认证或令牌失效'): ApiError =>
  new ApiError(401, 'UNAUTHENTICATED', message);

export const forbidden = (message = '无权访问'): ApiError =>
  new ApiError(403, 'FORBIDDEN', message);

export const notFound = (message = '资源不存在'): ApiError =>
  new ApiError(404, 'NOT_FOUND', message);

export const versionConflict = (message: string, details?: Record<string, unknown>): ApiError =>
  new ApiError(409, 'VERSION_CONFLICT', message, details);

export const deleted = (message = '资源已删除'): ApiError => new ApiError(409, 'DELETED', message);

export const preconditionFailed = (message: string, details?: Record<string, unknown>): ApiError =>
  new ApiError(412, 'VERSION_CONFLICT', message, details);

export const rebuildRequired = (message = '本地版本异常，请全量重建'): ApiError =>
  new ApiError(409, 'REBUILD_REQUIRED', message);

export const cursorExpired = (): ApiError =>
  new ApiError(410, 'CURSOR_EXPIRED', '同步游标已过期，请全量重建');

export const rateLimited = (message = '请求过于频繁', retryAfterSeconds = 60): ApiError =>
  new ApiError(
    429,
    'RATE_LIMITED',
    message,
    { retryAfter: retryAfterSeconds },
    {
      'Retry-After': String(retryAfterSeconds),
    },
  );
