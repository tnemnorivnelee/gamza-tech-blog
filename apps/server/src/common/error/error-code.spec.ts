import { ErrorCode } from './error-code.js';

const entries = Object.entries(ErrorCode);

describe('ErrorCode', () => {
  it('옛 enum의 46개 항목이 모두 있다', () => {
    expect(entries).toHaveLength(46);
  });

  it('code 문자열이 겹치지 않고 status는 4xx/5xx다', () => {
    const codes = entries.map(([, info]) => info.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const [name, info] of entries) {
      expect(info.status, name).toBeGreaterThanOrEqual(400);
      expect(info.status, name).toBeLessThan(600);
      expect(info.message, name).not.toBe('');
    }
  });

  // 옛 ErrorCode.java에서 값을 직접 확인한 항목들. 값이 이상해 보여도(ENTITY_NOT_FOUND가 400) 옛 동작이다.
  it.each([
    ['INVALID_INPUT_VALUE', 400, 'C001', '잘못된 입력 값입니다.'],
    ['ENTITY_NOT_FOUND', 400, 'C003', '엔티티를 찾을 수 없습니다.'],
    ['INTERNAL_SERVER_ERROR', 500, 'C004', '서버 내부 오류가 발생했습니다.'],
    ['EXPIRED_JWT', 403, 'J001', '만료된 JWT 토큰입니다.'],
    ['USER_NOT_FOUND', 404, 'U001', '사용자를 찾을 수 없습니다.'],
    ['POST_NOT_FOUND', 404, 'P001', '게시물을 찾을 수 없습니다.'],
    [
      'COMMENT_FORBIDDEN',
      403,
      'CM002',
      '댓글 작성자만 수정/삭제할 수 있습니다.',
    ],
    [
      'INTRO_DELETE_FORBIDDEN',
      403,
      'IN003',
      '본인만 자기소개를 삭제할 수 있습니다.',
    ],
  ] as const)('%s = %i %s', (name, status, code, message) => {
    expect(ErrorCode[name]).toEqual({ status, code, message });
  });
});
