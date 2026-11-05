// 토큰 상태를 적어 두는 공유 메모장의 계약. 지금은 인메모리, M2-4에서 Redis 구현으로 바꾼다.
// interface는 실행할 때 사라져서 Nest가 "무엇을 넣어 줄지" 알 수 없다. 남아 있는 추상 클래스를 이름표로 쓴다.
// M2-2에서는 블랙리스트만 쓴다. 리프레시 토큰 관련 메서드는 M2-3·M3에서 필요해질 때 더한다.
export abstract class TokenStore {
  // 로그아웃한 액세스 토큰인지 본다.
  abstract isAccessTokenBlacklisted(token: string): Promise<boolean>;
  // 액세스 토큰을 남은 수명(초)만큼 블랙리스트에 올린다. 수명이 지나면 저절로 빠진다.
  abstract blacklistAccessToken(
    token: string,
    ttlSeconds: number,
  ): Promise<void>;
}
