import type { ErrorCode } from './error-code.js';

// 옛 JwtAuthenticationException: 가드(옛 JWT 필터)가 던지는 인증 실패.
// 옛 JwtAuthenticationEntryPoint가 이 실패를 ErrorResponse가 아니라 ResponseDto 모양(data에 코드 문자열)으로
// 만들었다. 본문 모양이 달라서 BusinessException에 태울 수 없다(ValidationFailedException을 따로 둔 이유와 같다).
// BusinessException을 상속하지 않는다. 상속하면 필터의 첫 instanceof 검사에 먼저 걸려 ErrorResponse로 나간다.
export class JwtAuthenticationException extends Error {
  constructor(readonly errorCode: ErrorCode) {
    super(errorCode.message);
    this.name = 'JwtAuthenticationException';
  }
}
