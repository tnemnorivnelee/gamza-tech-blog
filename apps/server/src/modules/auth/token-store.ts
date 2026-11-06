// 토큰 상태를 적어 두는 공유 메모장의 계약. 지금은 인메모리, M2-4에서 Redis 구현으로 바꾼다.
// interface는 실행할 때 사라져서 Nest가 "무엇을 넣어 줄지" 알 수 없다. 남아 있는 추상 클래스를 이름표로 쓴다.
// 메서드는 옛 RefreshTokenDao·BlacklistServiceImpl이 Redis에 하던 일과 1:1이다. 키 이름은 괄호에 적었다.
export abstract class TokenStore {
  // 로그아웃한 액세스 토큰인지 본다. (blacklist:access:<토큰>)
  abstract isAccessTokenBlacklisted(token: string): Promise<boolean>;
  // 액세스 토큰을 남은 수명(초)만큼 블랙리스트에 올린다. 수명이 지나면 저절로 빠진다.
  abstract blacklistAccessToken(
    token: string,
    ttlSeconds: number,
  ): Promise<void>;

  // 사용자의 리프레시 토큰을 새 것으로 바꾼다. 이전 토큰이 있으면 지운다(사용자당 하나). M3의 로그인이 부른다.
  // (refresh:<토큰> → githubId, userRefresh:<githubId> → 토큰. 둘 다 같은 수명)
  abstract rotateRefreshToken(
    githubId: string,
    refreshToken: string,
    ttlSeconds: number,
  ): Promise<void>;
  // 리프레시 토큰의 주인(githubId)을 찾는다. 없으면 undefined. (refresh:<토큰>)
  abstract findGithubIdByRefreshToken(
    refreshToken: string,
  ): Promise<string | undefined>;
  // refresh:<토큰> 키의 만료만 새로 잡는다(Redis EXPIRE). userRefresh:<githubId> 키는 그대로다. 없는 토큰이면 아무 일도 없다.
  abstract extendRefreshToken(
    refreshToken: string,
    ttlSeconds: number,
  ): Promise<void>;
  // 사용자의 리프레시 토큰을 지운다. userRefresh:<githubId>가 가리키는 토큰을 찾아 두 키를 모두 지운다.
  abstract removeRefreshTokens(githubId: string): Promise<void>;
}
