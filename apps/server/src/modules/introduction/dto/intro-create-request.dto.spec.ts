import { ValidationFailedException } from '../../../common/error/input.exception.js';
import {
  type IntroCreateRequest,
  validateIntroCreateRequest,
} from './intro-create-request.dto.js';

const NOT_BLANK = '자기소개 내용은 필수입니다.';
const SIZE = '자기소개는 2~1000자 사이로 입력하세요.';

// 던진 검증 오류의 (필드, 값, 메시지) 목록을 꺼낸다. 통과하면 undefined다.
function errorsOf(request: unknown) {
  try {
    validateIntroCreateRequest(request as IntroCreateRequest | undefined);
  } catch (error) {
    if (error instanceof ValidationFailedException)
      return error.fieldErrors.map(({ field, value, reason }) => ({
        field,
        value,
        reason,
      }));
    throw error;
  }
  return undefined;
}

describe('validateIntroCreateRequest (옛 @NotBlank + @Size(min = 2, max = 1000))', () => {
  it.each([
    ['두 글자', '안녕'],
    ['1000자', '가'.repeat(1000)],
    ['앞뒤 공백이 있어도 글자 수는 그대로 센다(공백 포함 2자 이상)', ' a '],
    ['공백이 아닌 글자가 있는 두 글자', '가\n'],
  ])('통과한다: %s', (_label, content) => {
    expect(errorsOf({ content })).toBeUndefined();
  });

  // 없는 값은 @NotBlank만 위반한다(@Size는 null을 통과시킨다). 거부된 값은 빈 문자열로 나간다.
  it.each([
    ['content가 없다', {}],
    ['content가 null이다', { content: null }],
    ['본문이 아예 없다', undefined],
  ])('%s: 필수 오류 하나', (_label, request) => {
    expect(errorsOf(request)).toEqual([
      { field: 'content', value: '', reason: NOT_BLANK },
    ]);
  });

  // 빈 문자열은 둘 다 위반한다. 순서는 옛 Spring이 정하지 않아서 시험으로 고정하지 않고 둘 다 있는지만 본다.
  it('빈 문자열은 필수와 길이를 둘 다 위반한다', () => {
    const errors = errorsOf({ content: '' });
    expect(errors).toHaveLength(2);
    expect(errors).toEqual(
      expect.arrayContaining([
        { field: 'content', value: '', reason: NOT_BLANK },
        { field: 'content', value: '', reason: SIZE },
      ]),
    );
  });

  // @NotBlank는 Java의 trim(U+0020 이하)으로 보고, @Size는 trim하지 않은 길이로 본다.
  it('공백 두 글자는 필수만 위반한다(길이는 두 글자라서 통과)', () => {
    expect(errorsOf({ content: '  ' })).toEqual([
      { field: 'content', value: '  ', reason: NOT_BLANK },
    ]);
  });

  it('제어 문자만 있어도 비어 있다고 본다(Java의 trim)', () => {
    expect(errorsOf({ content: '\u0000\t\n' })).toEqual([
      { field: 'content', value: '\u0000\t\n', reason: NOT_BLANK },
    ]);
  });

  // 전각 공백(U+3000)은 Java의 trim이 지우지 않아서 글자로 센다. JS의 trim은 지워 버린다.
  it('전각 공백 두 글자는 비어 있지 않다', () => {
    expect(errorsOf({ content: '\u3000\u3000' })).toBeUndefined();
  });

  it.each([
    ['한 글자', '가', 1],
    ['1001자', '가'.repeat(1001), 1001],
  ])('%s는 길이 오류 하나다', (_label, content) => {
    expect(errorsOf({ content })).toEqual([
      { field: 'content', value: content, reason: SIZE },
    ]);
  });

  // 자바의 String.length()는 UTF-16 코드 단위 수라서 이모지 하나가 둘이다. JS의 length도 같다.
  it('이모지 하나는 두 글자로 센다(자바와 같다)', () => {
    expect(errorsOf({ content: '😀' })).toBeUndefined();
    expect(errorsOf({ content: '😀'.repeat(500) })).toBeUndefined();
    expect(errorsOf({ content: '😀'.repeat(501) })).toEqual([
      expect.objectContaining({ reason: SIZE }),
    ]);
  });

  // 문자열이 아닌 값은 이 시험이 다루지 않는 모양이다(옛 Jackson이 숫자를 문자열로 바꿨는지 확인하지 못했다). 필수 오류로 둔다.
  it('문자열이 아닌 값은 필수 오류다', () => {
    expect(errorsOf({ content: 5 })).toEqual([
      { field: 'content', value: '5', reason: NOT_BLANK },
    ]);
  });
});
