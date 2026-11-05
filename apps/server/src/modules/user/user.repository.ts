// 옛 UserRole. 가드가 요청마다 DB에서 읽어 ROLE_<role>을 만들었다(토큰에는 role이 없다).
export type UserRole = 'ADMIN' | 'USER' | 'PRE_REGISTER' | 'PENDING';

// shortcut: 가드에 필요한 필드(githubId, role)만 둔다. M4에서 Prisma 모델에 맞춰 늘린다.
export interface User {
  readonly githubId: string;
  readonly role: UserRole;
}

// 옛 UserRepository 포트. 구현을 바꿔 끼울 곳이라 인터페이스로 둔다.
// Nest는 인터페이스를 주입 토큰으로 쓸 수 없어서 추상 클래스로 만든다.
// M2에서는 findByGithubId만 쓴다. 나머지는 필요해질 때(M3 로그인, M4 Prisma) 더한다.
export abstract class UserRepository {
  abstract findByGithubId(githubId: string): Promise<User | undefined>;
}
