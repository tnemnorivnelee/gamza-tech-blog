import { Injectable } from '@nestjs/common';
import { type User, UserRepository } from './user.repository.js';

// shortcut: 메모리에만 저장하고 재시작하면 사라진다. 사용자를 만드는 기능(M3) 전에는 비어 있다. M4에서 Prisma 구현으로 바꾼다.
// users는 githubId → 사용자를 담은 Map이다. 없는 githubId는 undefined를 돌려준다.
@Injectable()
export class InMemoryUserRepository extends UserRepository {
  private readonly users = new Map<string, User>();

  findByGithubId(githubId: string): Promise<User | undefined> {
    return Promise.resolve(this.users.get(githubId));
  }
}
