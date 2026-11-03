import {
  applyDecorators,
  HttpCode,
  HttpStatus,
  type Type,
} from '@nestjs/common';
import { ApiOkResponse, ApiQuery } from '@nestjs/swagger';

// 문서의 200 응답과 실제 HTTP 200을 함께 건다. 옛 Spring은 POST도 200이고 Nest 기본은 201이다.
export const Ok = (dto: Type) =>
  applyDecorators(HttpCode(HttpStatus.OK), ApiOkResponse({ type: dto }));

// 옛 `@ParameterObject Pageable`이 펼치던 쿼리 파라미터 세 개.
export const ApiPageable = () =>
  applyDecorators(
    ApiQuery({
      name: 'page',
      required: false,
      schema: { type: 'integer', format: 'int32', minimum: 0, default: 0 },
    }),
    ApiQuery({
      name: 'size',
      required: false,
      schema: { type: 'integer', format: 'int32', minimum: 1, default: 20 },
    }),
    ApiQuery({
      name: 'sort',
      required: false,
      schema: { type: 'array', items: { type: 'string' } },
    }),
  );
