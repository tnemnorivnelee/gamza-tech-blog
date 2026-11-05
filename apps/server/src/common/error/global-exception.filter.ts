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

// 옛 GlobalExceptionHandler와 같은 매핑이다.
//  - JwtAuthenticationException → ErrorCode의 status. 본문은 ErrorResponse가 아니라 ResponseDto 모양이고
//                                 data에 code 문자열이 담긴다(옛 JwtAuthenticationEntryPoint가 그랬다)
//  - BusinessException      → ErrorCode의 status와 message
//  - 본문 검증 실패          → 400, C001, 필드별 오류
//  - 경로·쿼리 타입 불일치    → 400, C005
//  - 그 밖의 모든 예외        → 500, C004 (옛 catch-all. 응답에는 원인을 싣지 않는다)
// Nest 내부의 HttpException(없는 경로, 잘못된 JSON 등)도 마지막 항목으로 간다. 옛 catch-all이 그랬다.
// 그래서 가드·파이프에서도 HttpException 대신 BusinessException을 던진다.
// 알려진 차이: 옛 서버는 잘못된 HTTP 메서드에 405(C002)를 줬지만 Express는 이를 없는 경로와 구별하지 못한다.
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toResponse(exception);
    response.status(status).json(body);
  }

  private toResponse(exception: unknown) {
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
    if (exception instanceof BusinessException) {
      const { errorCode } = exception;
      return { status: errorCode.status, body: ErrorResponse.of(errorCode) };
    }
    if (exception instanceof ValidationFailedException) {
      const code = ErrorCode.INVALID_INPUT_VALUE;
      return {
        status: code.status,
        body: ErrorResponse.of(code, exception.fieldErrors),
      };
    }
    if (exception instanceof ArgumentTypeMismatchException) {
      const code = ErrorCode.INVALID_TYPE_VALUE;
      const error = FieldError.of(
        exception.field,
        exception.value,
        'typeMismatch',
      );
      return { status: code.status, body: ErrorResponse.of(code, [error]) };
    }

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
