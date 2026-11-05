import type { ErrorCode } from '../error/error-code.js';

// 옛 ErrorResponse.FieldError. value는 문자열이고 null이면 빈 문자열이다.
export class FieldError {
  constructor(
    readonly field: string,
    readonly value: string,
    readonly reason: string,
  ) {}

  static of(field: string, value: unknown, reason: string): FieldError {
    return new FieldError(field, value == null ? '' : String(value), reason);
  }
}

// 옛 ErrorResponse. 프론트는 body.message와 body.code를 읽는다.
// 옛 명세(OpenAPI)에는 나가지 않았으므로 Swagger 데코레이터를 달지 않는다.
export class ErrorResponse {
  readonly message: string;
  readonly status: number;
  readonly errors: FieldError[];
  readonly code: string;

  private constructor(errorCode: ErrorCode, errors: FieldError[]) {
    this.message = errorCode.message;
    this.status = errorCode.status;
    this.errors = errors;
    this.code = errorCode.code;
  }

  static of(errorCode: ErrorCode, errors: FieldError[] = []): ErrorResponse {
    return new ErrorResponse(errorCode, errors);
  }
}
