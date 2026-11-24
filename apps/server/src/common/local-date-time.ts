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

// UserProfileResponse의 날짜는 문자열 필드이고 MapStruct가 yyyy-MM-dd'T'HH:mm:ss로 만들었다(초까지, 소수점 없음).
// 초 아래는 반올림하지 않고 버린다. 읽는 기준은 toLocalDateTime과 같다(DB의 벽시계 값을 Date의 UTC 필드로 읽는다).
export const toLocalDateTimeSeconds = (date: Date): string =>
  date.toISOString().slice(0, 19);

// DB의 DATETIME에는 시간대 정보가 없고 옛 서버는 한국 시간(KST) 벽시계 값을 그대로 넣었다(docs/m4-prisma-plan.md 4절, D7).
// Prisma 어댑터는 Date의 UTC 필드를 그대로 DATETIME에 쓰고 읽는다(프로세스의 시간대와 무관하다). 그래서 옛 LocalDateTime.now()와
// 같은 "지금"을 쓰려면 UTC 필드가 KST 시각이 되도록 9시간을 더한 Date를 넘긴다. created_at·updated_at 쓰기와 "최근 1주" 같은 비교가 쓴다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const kstWallClockNow = (): Date => new Date(Date.now() + KST_OFFSET_MS);
