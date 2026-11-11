import { parsePageable } from './pageable.js';

const parse = (query: Record<string, unknown>, defaultSize = 10) =>
  parsePageable(query, defaultSize);

describe('parsePageable', () => {
  it('아무것도 없으면 0쪽, 기본 크기다', () => {
    expect(parse({})).toEqual({ page: 0, size: 10 });
    expect(parse({}, 20)).toEqual({ page: 0, size: 20 });
  });

  it('올바른 값은 그대로 쓴다', () => {
    expect(parse({ page: '3', size: '25' })).toEqual({ page: 3, size: 25 });
  });

  describe('page', () => {
    it.each(['', ' ', 'abc', '1.5', '1e3', '-1', '-2147483648', '99999999999'])(
      '%j는 0쪽이다(비었거나 숫자가 아니거나 음수, int 범위 밖)',
      (page) => {
        expect(parse({ page }).page).toBe(0);
      },
    );

    it('큰 값은 그대로 둔다(상한은 int 최대값)', () => {
      expect(parse({ page: '2147483647' }).page).toBe(2147483647);
    });
  });

  describe('size', () => {
    it.each(['', ' ', 'abc', '1.5', '0', '-1', '-2147483648', '99999999999'])(
      '%j는 기본 크기다(비었거나 숫자가 아니거나 1 미만, int 범위 밖)',
      (size) => {
        expect(parse({ size }, 10).size).toBe(10);
        expect(parse({ size }, 20).size).toBe(20);
      },
    );

    it('1은 그대로, 2000까지는 그대로, 2000을 넘으면 2000이다', () => {
      expect(parse({ size: '1' }).size).toBe(1);
      expect(parse({ size: '2000' }).size).toBe(2000);
      expect(parse({ size: '2001' }).size).toBe(2000);
      expect(parse({ size: '2147483647' }).size).toBe(2000);
    });
  });

  it('같은 이름이 여러 번 오면 첫 값만 쓴다', () => {
    expect(parse({ page: ['2', '5'], size: ['7', '9'] })).toEqual({
      page: 2,
      size: 7,
    });
  });

  it('프론트 생성 클라이언트의 중첩 형식(pageable[page]=1)은 못 읽고 기본값이다', () => {
    expect(parse({ pageable: { page: '1', size: '5' } })).toEqual({
      page: 0,
      size: 10,
    });
  });

  it('sort는 해석하지 않는다(글 목록은 요청의 sort를 무시한다)', () => {
    expect(parse({ sort: 'title,asc' })).toEqual({ page: 0, size: 10 });
  });
});
