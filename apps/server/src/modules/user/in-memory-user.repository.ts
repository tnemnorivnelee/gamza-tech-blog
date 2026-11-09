import { Injectable } from '@nestjs/common';
import { type NewUser, type User, UserRepository } from './user.repository.js';

// 시험용 가짜 구현이다. 운영에서는 PrismaUserRepository가 쓰인다(user.module.ts). 메모리에만 저장하고 재시작하면 사라진다.
// 닉네임·이메일이 겹치는지는 검사하지 않는다(DB의 unique 제약이 하던 일이고, Prisma 구현에서는 DB가 막는다).
// shortcut: 시험에만 쓰는데 src/에 있다. test/로 옮기는 정리는 따로 한다.
// users는 githubId → 사용자를 담은 Map이다. 없는 githubId는 undefined를 돌려준다.
@Injectable()
export class InMemoryUserRepository extends UserRepository {
  private readonly users = new Map<string, User>();

  findByGithubId(githubId: string): Promise<User | undefined> {
    return Promise.resolve(this.users.get(githubId));
  }

  create(user: NewUser): Promise<void> {
    this.users.set(user.githubId, user);
    return Promise.resolve();
  }

  // 공백만 있는 이메일도 비어 있는 것으로 본다(옛 StringUtils.hasText와 같다). 없는 사용자는 아무것도 하지 않는다.
  updateEmailIfEmpty(githubId: string, email: string): Promise<void> {
    const user = this.users.get(githubId);
    if (user && !user.email?.trim()) {
      this.users.set(githubId, { ...user, email });
    }
    return Promise.resolve();
  }
}
