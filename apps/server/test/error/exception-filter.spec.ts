import {
  Controller,
  Get,
  type INestApplication,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FieldError } from '../../src/common/dto/error-response.dto.js';
import { CommonModule } from '../../src/common/common.module.js';
import { BusinessException } from '../../src/common/error/business.exception.js';
import { ErrorCode } from '../../src/common/error/error-code.js';
import {
  ArgumentTypeMismatchException,
  ValidationFailedException,
} from '../../src/common/error/input.exception.js';

@Controller('boom')
class BoomController {
  @Get('business')
  business(): never {
    // 옛 처리기는 예외 메시지를 응답에 쓰지 않는다. 아래 문장이 응답에 보이면 안 된다.
    throw new BusinessException(
      ErrorCode.USER_NOT_FOUND,
      '1번 사용자를 찾을 수 없습니다.',
    );
  }

  @Get('validation')
  validation(): never {
    throw new ValidationFailedException([
      FieldError.of('content', null, '댓글 내용은 비어 있을 수 없습니다'),
      FieldError.of('parentCommentId', 7, '올바르지 않은 값입니다'),
    ]);
  }

  @Get('type')
  type(): never {
    throw new ArgumentTypeMismatchException('postId', 'abc');
  }

  @Get('unexpected')
  unexpected(): never {
    throw new Error('connection refused to 10.0.0.5');
  }

  @Get('http')
  http(): never {
    throw new NotFoundException('nope');
  }
}

describe('GlobalExceptionFilter', () => {
  let app: INestApplication;
  let baseUrl: string;
  const logError = vi
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => {});
  const logWarn = vi
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => {});

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CommonModule],
      controllers: [BoomController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(() => app.close());
  beforeEach(() => {
    logError.mockClear();
    logWarn.mockClear();
  });

  const call = async (path: string, method = 'GET') => {
    const res = await fetch(`${baseUrl}${path}`, { method });
    return { status: res.status, body: await res.json() };
  };

  it('BusinessException은 ErrorCode의 status·code·message로 나간다', async () => {
    const { status, body } = await call('/boom/business');
    expect(status).toBe(404);
    expect(body).toEqual({
      message: '사용자를 찾을 수 없습니다.',
      status: 404,
      errors: [],
      code: 'U001',
    });
    expect(Object.keys(body)).toEqual(['message', 'status', 'errors', 'code']);
    expect(logError).not.toHaveBeenCalled();
  });

  it('본문 검증 실패는 400 C001에 필드별 오류를 싣는다(null 값은 빈 문자열)', async () => {
    const { status, body } = await call('/boom/validation');
    expect(status).toBe(400);
    expect(body).toMatchObject({
      status: 400,
      code: 'C001',
      message: '잘못된 입력 값입니다.',
    });
    expect(body.errors).toEqual([
      {
        field: 'content',
        value: '',
        reason: '댓글 내용은 비어 있을 수 없습니다',
      },
      {
        field: 'parentCommentId',
        value: '7',
        reason: '올바르지 않은 값입니다',
      },
    ]);
  });

  it('경로·쿼리 타입 불일치는 400 C005에 typeMismatch를 싣는다', async () => {
    const { status, body } = await call('/boom/type');
    expect(status).toBe(400);
    expect(body).toMatchObject({ status: 400, code: 'C005' });
    expect(body.errors).toEqual([
      { field: 'postId', value: 'abc', reason: 'typeMismatch' },
    ]);
  });

  it('예상하지 못한 예외는 500 C004이고 원인을 응답에 싣지 않으며 로그를 남긴다', async () => {
    const { status, body } = await call('/boom/unexpected');
    expect(status).toBe(500);
    expect(body).toEqual({
      message: '서버 내부 오류가 발생했습니다.',
      status: 500,
      errors: [],
      code: 'C004',
    });
    expect(JSON.stringify(body)).not.toContain('connection refused');
    expect(logError).toHaveBeenCalledOnce();
  });

  it('Nest의 HttpException도 옛 catch-all처럼 500 C004이고 경고만 남긴다', async () => {
    const { status, body } = await call('/boom/http');
    expect(status).toBe(500);
    expect(body.code).toBe('C004');
    expect(logWarn).toHaveBeenCalledOnce();
    expect(logError).not.toHaveBeenCalled();
  });

  // 알려진 차이: 옛 서버는 405(C002)였다. Express는 잘못된 메서드를 없는 경로와 구별하지 못한다.
  it('없는 경로와 잘못된 메서드도 500 C004다', async () => {
    expect((await call('/no-such-route')).body.code).toBe('C004');
    expect((await call('/boom/business', 'POST')).body.code).toBe('C004');
  });
});
