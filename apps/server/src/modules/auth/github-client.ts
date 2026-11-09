// GitHub가 알려 주는 프로필 중 로그인에 쓰는 것만 담는다(옛 GithubUser가 읽던 id, login, name, email, avatar_url).
// 비공개로 둔 이름·이메일·이미지는 GitHub가 null로 준다.
export interface GithubProfile {
  readonly id: number;
  readonly login: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly avatarUrl: string | null;
}

// GitHub 서버에 보내는 요청 세 개의 계약(옛 GithubApiClient 중 로그인에 쓰는 부분). 운영 구현은 FetchGithubClient이고,
// 시험은 가짜를 끼워 GitHub를 실제로 부르지 않는다. 함수가 던지는 오류는 그대로 로그인 실패로 다룬다(실패하면 시작 경로로 되돌린다).
// interface는 실행할 때 사라져서 Nest가 "무엇을 넣어 줄지" 알 수 없다. 남아 있는 추상 클래스를 이름표로 쓴다.
export abstract class GithubClient {
  // 승인 화면에서 돌아온 code를 GitHub 액세스 토큰으로 바꾼다.
  abstract exchangeCode(code: string): Promise<string>;
  // 토큰 주인의 프로필을 가져온다.
  abstract fetchProfile(accessToken: string): Promise<GithubProfile>;
  // "주 이메일이면서 인증된 것"을 가져온다. 없으면 던진다(user:email 권한이 필요하다).
  abstract fetchPrimaryEmail(accessToken: string): Promise<string>;
}
