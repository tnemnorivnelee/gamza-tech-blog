import { Injectable } from '@nestjs/common';
import { type User, UserRepository } from './user.repository.js';

// shortcut: 메모리에만 저장하고 재시작하면 사라진다. 사용자를 만드는 기능(M3)이 생기기 전에는 비어 있다.
// M4에서 Prisma 구현으로 바꾼다(user.module.ts의 provider 한 줄).
@Injectable()
export class InMemoryUserRepository extends UserRepository {
  private readonly users = new Map<string, User>();

  findByGithubId(githubId: string): Promise<User | undefined> {
    return Promise.resolve(this.users.get(githubId));
  }
}
