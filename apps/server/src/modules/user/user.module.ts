import { Module } from '@nestjs/common';
import { ReadCacheModule } from '../../common/read-cache.module.js';
import { PrismaModule } from '../../infra/prisma/prisma.module.js';
import { PostModule } from '../post/post.module.js';
import { AdminUserController } from './admin-user.controller.js';
import { PrismaUserRepository } from './prisma-user.repository.js';
import { UserController } from './user.controller.js';
import { UserQueryRepository } from './user-query.repository.js';
import { UserWriteRepository } from './user-write.repository.js';
import { UserRepository } from './user.repository.js';
import { UserService } from './user.service.js';

// 사용자 기능 하나를 묶는 모듈이다. 컨트롤러·서비스·저장소를 한 모듈에 둔다(옛 Spring의 domain/user와 같은 구조).
// imports: PrismaModule(DB 연결), PostModule(공개 프로필이 그 사용자의 글 목록을 PostService로 만든다), ReadCacheModule(프로필 읽기 캐시).
// { provide: UserRepository, useClass: PrismaUserRepository }는 "UserRepository를 달라는 곳에는 PrismaUserRepository를 만들어 넣어 준다"는 뜻이다. 시험은 overrideProvider로 가짜(InMemoryUserRepository)를 끼운다.
// exports: AuthModule의 가드와 로그인이 UserRepository를 쓸 수 있게 내보낸다. AuthModule을 쓰는 시험 앱에 글 모듈이 같이 딸려 와도 시험은 깨지지 않는다(docs/m5-read-api-plan.md 15절).
@Module({
  imports: [PrismaModule, PostModule, ReadCacheModule],
  controllers: [UserController, AdminUserController],
  providers: [
    { provide: UserRepository, useClass: PrismaUserRepository },
    UserService,
    UserQueryRepository,
    UserWriteRepository,
  ],
  exports: [UserRepository],
})
export class UserModule {}
