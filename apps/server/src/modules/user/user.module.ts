import { Module } from '@nestjs/common';
import { InMemoryUserRepository } from './in-memory-user.repository.js';
import { UserRepository } from './user.repository.js';

// "UserRepository를 달라는 곳에는 InMemoryUserRepository를 만들어 넣어 준다"는 뜻이다.
// M4에서 useClass만 Prisma 구현으로 바꾸면 쓰는 쪽 코드는 그대로다. exports로 다른 모듈이 쓸 수 있게 내보낸다.
@Module({
  providers: [{ provide: UserRepository, useClass: InMemoryUserRepository }],
  exports: [UserRepository],
})
export class UserModule {}
