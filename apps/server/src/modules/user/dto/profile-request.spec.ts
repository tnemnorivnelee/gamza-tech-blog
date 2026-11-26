import { BusinessException } from '../../../common/error/business.exception.js';
import { ErrorCode } from '../../../common/error/error-code.js';
import { ValidationFailedException } from '../../../common/error/input.exception.js';
import { POSITIONS, readProfileRequest } from './profile-request.js';

const VALID = {
  email: 'jihun@example.com',
  studentNumber: '20231234',
  gamjaBatch: 9,
  position: 'BACKEND',
};
const COMPLETE = { emailRequired: false };
const UPDATE = { emailRequired: true };

// 위반한 칸과 메시지만 뽑아 본다(오류 순서는 옛 Spring이 정하지 않아서 시험도 순서를 고정하지 않는다).
function violations(body: unknown, rules: { emailRequired: boolean }) {
  try {
    readProfileRequest(body, rules);
  } catch (error) {
    if (error instanceof ValidationFailedException)
      return error.fieldErrors.map((e) => [e.field, e.reason, e.value]);
    throw error;
  }
  return [];
}

describe('readProfileRequest (옛 @Valid UserProfileRequest·UpdateProfileRequest)', () => {
  it('옛 Position enum의 선언 순서가 OpenAPI enum 순서다', () => {
    expect([...POSITIONS]).toEqual([
      'BACKEND',
      'FRONTEND',
      'DESIGNER',
      'APP_DEVELOPER',
    ]);
  });

  it.each([
    ['완성', COMPLETE],
    ['수정', UPDATE],
  ])('%s: 값이 모두 맞으면 그대로 돌려준다', (_name, rules) => {
    expect(readProfileRequest(VALID, rules)).toEqual(VALID);
  });

  it('칸의 값은 다듬지 않는다(학번 앞뒤 공백 포함)', () => {
    expect(
      readProfileRequest({ ...VALID, studentNumber: ' 2023 ' }, COMPLETE)
        .studentNumber,
    ).toBe(' 2023 ');
  });

  describe('이메일', () => {
    it('완성에서는 없어도, 비어 있어도 통과하고 없으면 null이다', () => {
      expect(
        readProfileRequest({ ...VALID, email: undefined }, COMPLETE).email,
      ).toBeNull();
      expect(
        readProfileRequest({ ...VALID, email: null }, COMPLETE).email,
      ).toBeNull();
      expect(readProfileRequest({ ...VALID, email: '' }, COMPLETE).email).toBe(
        '',
      );
    });

    it('수정에서는 없으면 필수 오류 하나다(null은 @Email을 통과한다)', () => {
      const missing = [['email', '공백일 수 없습니다', '']];
      expect(violations({ ...VALID, email: undefined }, UPDATE)).toEqual(
        missing,
      );
      expect(violations({ ...VALID, email: null }, UPDATE)).toEqual(missing);
      expect(violations({ ...VALID, email: '' }, UPDATE)).toEqual(missing);
    });

    it('공백만 있으면 수정은 필수와 형식 오류 둘, 완성은 형식 오류 하나다', () => {
      const blank = { ...VALID, email: '  ' };
      expect(violations(blank, UPDATE)).toEqual([
        ['email', '공백일 수 없습니다', '  '],
        ['email', '올바른 형식의 이메일 주소여야 합니다', '  '],
      ]);
      expect(violations(blank, COMPLETE)).toEqual([
        ['email', '올바른 형식의 이메일 주소여야 합니다', '  '],
      ]);
    });

    it.each([
      ['완성', COMPLETE],
      ['수정', UPDATE],
    ])('%s: 형식이 틀리면 거부한다', (_name, rules) => {
      expect(violations({ ...VALID, email: 'not-an-email' }, rules)).toEqual([
        ['email', '올바른 형식의 이메일 주소여야 합니다', 'not-an-email'],
      ]);
    });
  });

  describe('학번', () => {
    it.each([
      ['없음', undefined],
      ['null', null],
      ['빈 문자열', ''],
      ['공백만', '   '],
      // Java의 trim은 U+0020 이하를 모두 지운다(탭, 줄바꿈, 제어 문자 포함).
      ['제어 문자만', '\t\n\u0001'],
    ])('필수다: %s', (_name, studentNumber) => {
      const found = violations({ ...VALID, studentNumber }, COMPLETE);
      expect(found).toHaveLength(1);
      expect(found[0].slice(0, 2)).toEqual([
        'studentNumber',
        '공백일 수 없습니다',
      ]);
    });

    it('전각 공백은 글자로 본다(Java trim은 지우지 않는다)', () => {
      expect(
        readProfileRequest({ ...VALID, studentNumber: '　' }, COMPLETE)
          .studentNumber,
      ).toBe('　');
    });
  });

  it.each([
    ['gamjaBatch', '널이어서는 안됩니다'],
    ['position', '널이어서는 안됩니다'],
  ])('%s가 없으면 거부한다', (field, message) => {
    expect(violations({ ...VALID, [field]: undefined }, COMPLETE)).toEqual([
      [field, message, ''],
    ]);
    expect(violations({ ...VALID, [field]: null }, UPDATE)).toEqual([
      [field, message, ''],
    ]);
  });

  it('여러 칸이 틀리면 모두 알려 준다', () => {
    const found = violations({}, COMPLETE);
    expect(found.map((e) => e[0]).sort()).toEqual([
      'gamjaBatch',
      'position',
      'studentNumber',
    ]);
    expect(
      violations({}, UPDATE)
        .map((e) => e[0])
        .sort(),
    ).toEqual(['email', 'gamjaBatch', 'position', 'studentNumber']);
  });

  it.each([undefined, null, [], 'text', 7])(
    '본문이 객체가 아니면 모든 칸이 없는 것으로 본다: %j',
    (body) => {
      expect(violations(body, COMPLETE)).toHaveLength(3);
    },
  );

  describe('읽을 수 없는 값은 500 C004다(옛 Jackson 읽기 실패)', () => {
    it.each([
      ['포지션이 enum 밖의 문자열', { position: 'SENIOR' }],
      ['포지션의 대소문자 다름', { position: 'backend' }],
      ['포지션이 숫자', { position: 0 }],
      ['기수가 문자열', { gamjaBatch: '9' }],
      ['기수가 소수', { gamjaBatch: 9.5 }],
      ['기수가 int 범위 밖', { gamjaBatch: 2 ** 31 }],
      ['기수가 불리언', { gamjaBatch: true }],
      ['학번이 숫자', { studentNumber: 20231234 }],
      ['이메일이 객체', { email: {} }],
    ])('%s', (_name, patch) => {
      try {
        readProfileRequest({ ...VALID, ...patch }, COMPLETE);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException);
        expect((error as BusinessException).errorCode).toBe(
          ErrorCode.INTERNAL_SERVER_ERROR,
        );
      }
    });

    it('읽기 실패가 검사 위반보다 먼저다', () => {
      expect(() =>
        readProfileRequest({ studentNumber: '', position: 'SENIOR' }, COMPLETE),
      ).toThrow(BusinessException);
    });

    it('int 범위의 끝 값은 읽는다', () => {
      expect(
        readProfileRequest({ ...VALID, gamjaBatch: 2 ** 31 - 1 }, COMPLETE)
          .gamjaBatch,
      ).toBe(2 ** 31 - 1);
      expect(
        readProfileRequest({ ...VALID, gamjaBatch: -(2 ** 31) }, COMPLETE)
          .gamjaBatch,
      ).toBe(-(2 ** 31));
    });
  });
});
