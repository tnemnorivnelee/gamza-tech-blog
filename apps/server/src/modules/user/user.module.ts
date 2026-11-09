import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module.js';
import { PrismaUserRepository } from './prisma-user.repository.js';
import { UserRepository } from './user.repository.js';

// "UserRepository를 달라는 곳에는 PrismaUserRepository를 만들어 넣어 준다"는 뜻이다. 시험은 overrideProvider로 가짜(InMemoryUserRepository)를 끼운다.
// PrismaUserRepository가 PrismaService를 필요로 해서 PrismaModule을 imports에 적는다. exports로 다른 모듈이 UserRepository를 쓸 수 있게 내보낸다.
@Module({
  imports: [PrismaModule],
  providers: [{ provide: UserRepository, useClass: PrismaUserRepository }],
  exports: [UserRepository],
})
export class UserModule {}
