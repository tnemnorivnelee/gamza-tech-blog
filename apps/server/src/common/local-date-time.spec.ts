import { toLocalDateTime, toLocalDateTimeSeconds } from './local-date-time.js';

describe('toLocalDateTime', () => {
  // DB에 적힌 서울 벽시계 값이 Date의 UTC 필드로 들어오는 약속이다(m4-prisma-plan.md 11절).
  it.each([
    ['2025-07-27T21:08:37.109Z', '2025-07-27T21:08:37.109'],
    ['2025-07-27T21:08:37.120Z', '2025-07-27T21:08:37.12'],
    ['2025-07-27T21:08:37.100Z', '2025-07-27T21:08:37.1'],
    ['2025-07-27T21:08:37.001Z', '2025-07-27T21:08:37.001'],
    ['2025-07-27T21:08:37.010Z', '2025-07-27T21:08:37.01'],
  ])('%s → %s (소수점은 0이 아닌 자리까지)', (iso, expected) => {
    expect(toLocalDateTime(new Date(iso))).toBe(expected);
  });

  it('밀리초가 0이면 소수점을 생략하고, 초가 0이어도 초는 쓴다', () => {
    expect(toLocalDateTime(new Date('2025-07-27T21:08:00.000Z'))).toBe(
      '2025-07-27T21:08:00',
    );
    expect(toLocalDateTime(new Date('2025-07-27T00:00:00.000Z'))).toBe(
      '2025-07-27T00:00:00',
    );
  });

  it('끝이 0인 초(30)와 밀리초(.000)를 혼동하지 않는다', () => {
    expect(toLocalDateTime(new Date('2025-07-27T21:08:30.000Z'))).toBe(
      '2025-07-27T21:08:30',
    );
    expect(toLocalDateTime(new Date('2025-07-27T21:08:30.500Z'))).toBe(
      '2025-07-27T21:08:30.5',
    );
  });

  it('시간대 표시(Z)가 없다', () => {
    expect(toLocalDateTime(new Date('2099-01-01T00:00:00.000Z'))).not.toMatch(
      /Z|\+/,
    );
  });
});

describe('toLocalDateTimeSeconds', () => {
  // UserProfileResponse의 날짜: 초까지만 쓴다. 밀리초가 있어도 소수점이 없고, 반올림하지 않고 버린다.
  it.each([
    ['2025-07-27T21:08:37.109Z', '2025-07-27T21:08:37'],
    ['2025-07-27T21:08:37.999Z', '2025-07-27T21:08:37'],
    ['2025-07-27T21:08:00.000Z', '2025-07-27T21:08:00'],
    ['2025-12-31T23:59:59.999Z', '2025-12-31T23:59:59'],
  ])('%s → %s', (iso, expected) => {
    expect(toLocalDateTimeSeconds(new Date(iso))).toBe(expected);
  });
});
