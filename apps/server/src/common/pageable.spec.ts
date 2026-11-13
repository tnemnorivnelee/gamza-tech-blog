import { parsePageable, parseSort, type SortOrder } from './pageable.js';

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

describe('parseSort', () => {
  const DEFAULT: SortOrder[] = [{ property: 'createdAt', direction: 'desc' }];
  const sort = (value: unknown) => parseSort({ sort: value }, DEFAULT);

  it('sort가 없거나 비었으면 기본 정렬이다', () => {
    expect(parseSort({}, DEFAULT)).toBe(DEFAULT);
    expect(sort('')).toBe(DEFAULT);
    expect(sort(',')).toBe(DEFAULT);
    expect(sort(',desc')).toBe(DEFAULT); // 속성이 빈 조각뿐이다
    expect(sort(undefined)).toBe(DEFAULT);
  });

  it('속성과 방향을 읽는다', () => {
    expect(sort('createdAt,desc')).toEqual([
      { property: 'createdAt', direction: 'desc' },
    ]);
    expect(sort('id,asc')).toEqual([{ property: 'id', direction: 'asc' }]);
  });

  it('방향은 대소문자를 구분하지 않는다', () => {
    expect(sort('id,DESC')).toEqual([{ property: 'id', direction: 'desc' }]);
    expect(sort('id,Asc')).toEqual([{ property: 'id', direction: 'asc' }]);
  });

  it('방향이 없으면 오름차순이다', () => {
    expect(sort('id')).toEqual([{ property: 'id', direction: 'asc' }]);
    expect(sort('id,')).toEqual([{ property: 'id', direction: 'asc' }]); // 끝의 빈 조각은 버린다
  });

  it('방향 자리가 방향이 아니면 그 조각도 속성이다(다듬지 않는다)', () => {
    expect(sort('createdAt, desc')).toEqual([
      { property: 'createdAt', direction: 'asc' },
      { property: ' desc', direction: 'asc' },
    ]);
    expect(sort('id,up')).toEqual([
      { property: 'id', direction: 'asc' },
      { property: 'up', direction: 'asc' },
    ]);
  });

  // Java의 split은 끝의 빈 조각을 버려서 "id,desc,"의 마지막 실제 조각이 desc다.
  it('끝에 쉼표가 더 있어도 방향을 읽는다', () => {
    expect(sort('id,desc,')).toEqual([{ property: 'id', direction: 'desc' }]);
  });

  it('asc, desc로 시작할 뿐인 조각은 방향이 아니다', () => {
    expect(sort('id,descending')).toEqual([
      { property: 'id', direction: 'asc' },
      { property: 'descending', direction: 'asc' },
    ]);
  });

  it('공백뿐인 속성은 빈 속성처럼 건너뛴다(Spring의 hasText)', () => {
    expect(sort(' ,desc')).toBe(DEFAULT);
    expect(sort('id, ,desc')).toEqual([{ property: 'id', direction: 'desc' }]);
  });

  it('속성 여러 개에 방향 하나는 모두에 적용된다', () => {
    expect(sort('createdAt,id,desc')).toEqual([
      { property: 'createdAt', direction: 'desc' },
      { property: 'id', direction: 'desc' },
    ]);
  });

  it('여러 번 온 sort는 순서대로 모은다(배열)', () => {
    expect(sort(['createdAt,desc', 'id,asc'])).toEqual([
      { property: 'createdAt', direction: 'desc' },
      { property: 'id', direction: 'asc' },
    ]);
  });

  it('요청의 sort는 기본 정렬에 더해지지 않고 바꾼다', () => {
    expect(sort('id,asc')).not.toContainEqual(DEFAULT[0]);
  });

  it('문자열이 아닌 값은 없는 것으로 본다(?sort[a]=b 같은 중첩)', () => {
    expect(sort({ a: 'b' })).toBe(DEFAULT);
    expect(sort([{ a: 'b' }, 'id,asc'])).toEqual([
      { property: 'id', direction: 'asc' },
    ]);
  });
});
