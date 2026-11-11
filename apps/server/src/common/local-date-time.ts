// 옛 서버의 Jackson이 LocalDateTime을 내보내던 모양이다: 2025-07-27T21:08:37.109696
// 시간대 표시가 없고, 소수점 아래는 0이 아닌 자리까지만 쓰고, 전부 0이면 소수점도 생략한다. 초는 0이어도 쓴다.
//
// DB의 DATETIME은 서울 벽시계 값이고 Prisma는 그것을 Date의 UTC 필드로 준다(docs/m4-prisma-plan.md 11절).
// 그래서 UTC 기준으로 읽으면 DB에 적힌 그 시각이 나온다. 프로세스의 시간대와 무관하다.
// Date는 밀리초까지라서 DB의 마이크로초 중 아래 세 자리는 버려진다(docs/m5-read-api-plan.md D3).
export function toLocalDateTime(date: Date): string {
  const seconds = date.toISOString().slice(0, 19);
  const millis = String(date.getUTCMilliseconds())
    .padStart(3, '0')
    .replace(/0+$/, '');
  return millis === '' ? seconds : `${seconds}.${millis}`;
}
