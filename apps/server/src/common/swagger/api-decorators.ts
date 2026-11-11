import {
  applyDecorators,
  HttpCode,
  HttpStatus,
  type Type,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiQuery,
  getSchemaPath,
  type ReferenceObject,
  type SchemaObject,
} from '@nestjs/swagger';
import { PagedResponse } from '../dto/paged-response.dto.js';
import { ResponseDto } from '../dto/response.dto.js';

type Schema = SchemaObject | ReferenceObject;
const ref = (model: Type): Schema => ({ $ref: getSchemaPath(model) });

// 모든 응답은 HTTP 200이다. 옛 Spring은 POST도 200이고 Nest 기본은 201이라, 문서의 200 응답과 함께 건다.
// 공통 껍데기(ResponseDto)는 $ref로 가져오고, 이 응답의 data 자리만 적는다.
// title은 이름 없는 스키마에 대해 openapi-generator가 모델 이름으로 쓰는 힌트다.
// 옛 명세의 ResponseDtoXxx 이름과 같게 맞춘다(생성기가 실제로 쓰는지는 M8의 전체 생성기 비교에서 확인한다).
function okResponse(title: string, data?: Schema, models: Type[] = []) {
  return applyDecorators(
    HttpCode(HttpStatus.OK),
    ApiExtraModels(ResponseDto, ...models),
    ApiOkResponse({
      schema: {
        title,
        allOf: [ref(ResponseDto), ...(data ? [{ properties: { data } }] : [])],
      },
    }),
  );
}

/** data: 모델 하나 */
export const OkOf = (model: Type) =>
  okResponse(`ResponseDto${model.name}`, ref(model), [model]);

/** data: 모델 목록(또는 문자열 목록) */
export const OkListOf = (model: Type | StringConstructor) =>
  model === String
    ? okResponse('ResponseDtoListString', {
        type: 'array',
        items: { type: 'string' },
      })
    : okResponse(
        `ResponseDtoList${model.name}`,
        { type: 'array', items: ref(model as Type) },
        [model as Type],
      );

/** data: 페이지 단위 목록(PagedResponse) */
export const OkPagedOf = (model: Type) =>
  okResponse(
    `ResponseDtoPagedResponse${model.name}`,
    {
      title: `PagedResponse${model.name}`,
      allOf: [
        ref(PagedResponse),
        { properties: { content: { type: 'array', items: ref(model) } } },
      ],
    },
    [PagedResponse, model],
  );

export const OkString = () =>
  okResponse('ResponseDtoString', { type: 'string' });
export const OkLong = () =>
  okResponse('ResponseDtoLong', { type: 'integer', format: 'int64' });
export const OkBoolean = () =>
  okResponse('ResponseDtoBoolean', { type: 'boolean' });
/** data 없음. 옛 명세의 ResponseDtoVoid는 data를 object로 적었다. */
export const OkVoid = () => okResponse('ResponseDtoVoid', { type: 'object' });

// 옛 `@ParameterObject Pageable`이 펼치던 쿼리 파라미터 세 개. defaultSize는 문서에 적는 기본 크기다
// (@PageableDefault가 있는 목록은 10, 없으면 Spring 기본값 20). 실제 기본값은 컨트롤러가 parsePageable에 넘기는 값이다.
export const ApiPageable = (defaultSize = 20) =>
  applyDecorators(
    ApiQuery({
      name: 'page',
      required: false,
      schema: { type: 'integer', format: 'int32', minimum: 0, default: 0 },
    }),
    ApiQuery({
      name: 'size',
      required: false,
      schema: {
        type: 'integer',
        format: 'int32',
        minimum: 1,
        default: defaultSize,
      },
    }),
    ApiQuery({
      name: 'sort',
      required: false,
      schema: { type: 'array', items: { type: 'string' } },
    }),
  );
