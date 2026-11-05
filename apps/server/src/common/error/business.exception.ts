import type { ErrorCode } from './error-code.js';

// 옛 BusinessException. 도메인 예외는 하위 클래스를 만들지 않고 이것에 ErrorCode만 실어 던진다
// (옛 하위 클래스 약 20개는 전부 ErrorCode 하나만 넘겼다).
// 응답에는 예외 메시지가 아니라 ErrorCode의 message가 나간다. 그래서 message는 로그를 읽는 사람용이다.
export class BusinessException extends Error {
  constructor(
    readonly errorCode: ErrorCode,
    message?: string,
  ) {
    super(message ?? errorCode.message);
    this.name = 'BusinessException';
  }
}
