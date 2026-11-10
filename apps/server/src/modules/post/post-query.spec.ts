import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import { parseTags, readKeyword } from './post-query.js';

describe('parseTags', () => {
  it('값이 하나면 쉼표로 쪼개고 조각마다 앞뒤 공백을 자른다', () => {
    expect(parseTags('a')).toEqual(['a']);
    expect(parseTags('a,b')).toEqual(['a', 'b']);
    expect(parseTags(' a , b ')).toEqual(['a', 'b']);
  });

  it('값이 여러 개(tags=a&tags=b)면 쪼개지 않고 그대로 쓴다', () => {
    expect(parseTags(['a', 'b'])).toEqual(['a', 'b']);
    expect(parseTags(['a,b', 'c'])).toEqual(['a,b', 'c']);
  });

  // Spring은 tags[]=a도 tags로 읽고, 값이 하나뿐이면 문자열로 보고 쪼갠다.
  it('값이 하나뿐인 배열(tags[]=a,b)은 단일 값처럼 쪼갠다', () => {
    expect(parseTags(['a,b'])).toEqual(['a', 'b']);
  });

  it('없거나 빈 문자열이면 빈 목록이다(필터 없음)', () => {
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags('')).toEqual([]);
    expect(parseTags([])).toEqual([]);
  });

  it('쉼표만 있으면 빈 조각이 남는다(Spring의 쉼표 분리와 같다)', () => {
    expect(parseTags('a,')).toEqual(['a', '']);
    expect(parseTags(',')).toEqual(['', '']);
  });

  it('문자열이 아닌 값(중첩 객체)은 무시한다', () => {
    expect(parseTags({ a: 'b' })).toEqual([]);
    expect(parseTags(['a', { b: 'c' }])).toEqual(['a']);
  });

  it('한글 태그도 그대로다', () => {
    expect(parseTags('백엔드,데이터베이스')).toEqual([
      '백엔드',
      '데이터베이스',
    ]);
  });
});

describe('readKeyword', () => {
  const fails = (query: Record<string, unknown>) => {
    try {
      readKeyword(query);
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessException);
      expect((error as BusinessException).errorCode).toBe(
        ErrorCode.INTERNAL_SERVER_ERROR,
      );
      return;
    }
    throw new Error('예외가 나지 않았다');
  };

  it('검색어를 다듬지 않고 그대로 돌려준다', () => {
    expect(readKeyword({ keyword: ' Spring ' })).toBe(' Spring ');
    expect(readKeyword({ keyword: '100%_' })).toBe('100%_');
  });

  it.each([{}, { keyword: '' }, { keyword: '   ' }, { keyword: '\n\t' }])(
    '없거나 공백뿐이면(%j) 500 C004다',
    (query) => {
      fails(query);
    },
  );

  it('중첩 형식(keyword[a]=b)은 없는 것과 같다', () => {
    fails({ keyword: { a: 'b' } });
  });

  // Hibernate Validator의 @NotBlank는 Java trim 기준이라 전각 공백만 있는 검색어는 통과한다.
  it('전각 공백만 있는 검색어는 통과한다(JS trim과 다른 곳)', () => {
    expect(readKeyword({ keyword: '　' })).toBe('　');
  });

  it('같은 이름이 여러 번 오면 첫 값을 쓴다', () => {
    expect(readKeyword({ keyword: ['a', 'b'] })).toBe('a');
  });
});
