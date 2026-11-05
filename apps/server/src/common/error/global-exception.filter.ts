import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ErrorResponse, FieldError } from '../dto/error-response.dto.js';
import { ResponseDto } from '../dto/response.dto.js';
import { BusinessException } from './business.exception.js';
import { ErrorCode } from './error-code.js';
import {
  ArgumentTypeMismatchException,
  ValidationFailedException,
} from './input.exception.js';
import { JwtAuthenticationException } from './jwt-authentication.exception.js';

// @Catch(): 컨트롤러·가드 등에서 던져진 모든 예외를 이 필터가 받는다(프론트의 error boundary와 비슷하다).
// 예외 종류에 따라 상태 코드와 본문을 정한다. 옛 GlobalExceptionHandler와 같은 매핑이다.
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  // 예외가 던져지면 Nest가 이 메서드를 부른다. 응답을 직접 만들어 보낸다.
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toResponse(exception);
    response.status(status).json(body);
  }

  // 위에서부터 차례로 검사해서 처음 맞는 예외 종류의 응답을 돌려준다.
  private toResponse(exception: unknown) {
    // 인증 실패: 본문이 ErrorResponse가 아니라 ResponseDto 모양이고 data에 코드가 담긴다(옛 JwtAuthenticationEntryPoint).
    if (exception instanceof JwtAuthenticationException) {
      const { errorCode } = exception;
      return {
        status: errorCode.status,
        body: ResponseDto.of(
          errorCode.message,
          errorCode.code,
          errorCode.status,
        ),
      };
    }
    // 업무 규칙 위반: ErrorCode의 상태와 메시지. 던진 쪽의 메시지는 응답에 쓰지 않는다.
    if (exception instanceof BusinessException) {
      const { errorCode } = exception;
      return { status: errorCode.status, body: ErrorResponse.of(errorCode) };
    }
    // 요청 본문 검증 실패: 400, C001, 필드별 오류.
    if (exception instanceof ValidationFailedException) {
      const code = ErrorCode.INVALID_INPUT_VALUE;
      return {
        status: code.status,
        body: ErrorResponse.of(code, exception.fieldErrors),
      };
    }
    // 경로·쿼리 값의 타입이 안 맞음: 400, C005.
    if (exception instanceof ArgumentTypeMismatchException) {
      const code = ErrorCode.INVALID_TYPE_VALUE;
      const error = FieldError.of(
        exception.field,
        exception.value,
        'typeMismatch',
      );
      return { status: code.status, body: ErrorResponse.of(code, [error]) };
    }

    // 그 밖의 모든 예외는 500, C004다(옛 catch-all). 원인은 응답에 싣지 않고 로그에만 남긴다.
    // Nest 내부의 HttpException(없는 경로 등)도 여기로 오므로, 가드·파이프에서는 HttpException 대신 BusinessException을 던진다.
    if (exception instanceof HttpException) {
      this.logger.warn(`${exception.getStatus()} ${exception.message}`);
    } else {
      this.logger.error(
        '처리되지 않은 예외',
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    const code = ErrorCode.INTERNAL_SERVER_ERROR;
    return { status: code.status, body: ErrorResponse.of(code) };
  }
}
