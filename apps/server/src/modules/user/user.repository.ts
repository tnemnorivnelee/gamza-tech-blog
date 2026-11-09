// 사용자 role. 토큰에는 role이 없어서 가드가 요청마다 DB에서 읽는다(옛 동작).
export type UserRole = 'ADMIN' | 'USER' | 'PRE_REGISTER' | 'PENDING';

// shortcut: 가드에 필요한 필드(githubId, role)만 둔다. M4에서 Prisma 모델에 맞춰 늘린다.
export interface User {
  readonly githubId: string;
  readonly role: UserRole;
}

// 로그인이 처음 온 사용자를 만들 때 쓰는 값(옛 UserMapper.toEntity). 학번·기수·포지션은 가입 화면(M5)에서 채우므로 아직 없다.
// shortcut: 가드가 읽지 않는 필드라서 User와 따로 둔다. M4에서 Prisma 모델에 맞춰 하나로 합친다.
export interface NewUser extends User {
  readonly name: string;
  readonly nickname: string;
  readonly email: string | null;
}

// 사용자 저장소의 계약. 구현을 바꿔 끼울 곳(지금 인메모리, M4에서 Prisma)이라 타입으로 분리했다.
// interface는 실행할 때 사라져서 Nest가 "무엇을 넣어 줄지" 알 수 없다. 남아 있는 추상 클래스를 이름표로 쓴다.
// 필요해지는 대로 메서드를 더한다: 가드가 findByGithubId를, GitHub 로그인(M3)이 create를 쓴다.
export abstract class UserRepository {
  abstract findByGithubId(githubId: string): Promise<User | undefined>;
  abstract create(user: NewUser): Promise<void>;
}
