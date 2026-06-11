import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: ContentfulStatusCode,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function errorBody(error: unknown): { error: string; code?: string } {
  if (error instanceof ApiError) {
    return error.code ? { error: error.message, code: error.code } : { error: error.message };
  }
  return { error: 'Internal server error' };
}
