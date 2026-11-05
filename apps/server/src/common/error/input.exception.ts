import type { FieldError } from '../dto/error-response.dto.js';

// 옛 MethodArgumentNotValidException: 요청 본문 검증 실패. 400, INVALID_INPUT_VALUE.
export class ValidationFailedException extends Error {
  constructor(readonly fieldErrors: FieldError[]) {
    super('요청 값 검증에 실패했다.');
    this.name = 'ValidationFailedException';
  }
}

// 옛 MethodArgumentTypeMismatchException: 경로·쿼리 값이 기대한 타입이 아님. 400, INVALID_TYPE_VALUE.
export class ArgumentTypeMismatchException extends Error {
  constructor(
    readonly field: string,
    readonly value: unknown,
  ) {
    super(`${field} 값의 타입이 맞지 않는다.`);
    this.name = 'ArgumentTypeMismatchException';
  }
}
