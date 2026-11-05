import type { ErrorCode } from './error-code.js';

// 가드가 던지는 인증 실패. 응답 본문이 ErrorResponse가 아니라 ResponseDto 모양(data에 코드)이어야 해서
// BusinessException과 분리했다(옛 JwtAuthenticationEntryPoint). 상속하면 필터가 ErrorResponse로 내보내므로 상속하지 않는다.
export class JwtAuthenticationException extends Error {
  constructor(readonly errorCode: ErrorCode) {
    super(errorCode.message);
    this.name = 'JwtAuthenticationException';
  }
}
