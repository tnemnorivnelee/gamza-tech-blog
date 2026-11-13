import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module.js';
import { PostModule } from '../post/post.module.js';
import { AdminUserController } from './admin-user.controller.js';
import { UserController } from './user.controller.js';
import { UserQueryRepository } from './user-query.repository.js';
import { UserService } from './user.service.js';

// 사용자 API(프로필, 활동, 공개 프로필, 승인 대기 목록)를 묶는 모듈이다.
// 가드가 쓰는 UserRepository를 내주는 UserModule과 따로 둔다. AuthModule이 UserModule을 가져오는데, 여기에 PostModule을 가져오는 컨트롤러까지
// 넣으면 AuthModule을 쓰는 모든 시험 앱에 글 컨트롤러와 실제 서비스가 딸려 와서 가짜 서비스를 끼운 시험이 틀어진다.
// UserService가 공개 프로필의 글 목록을 만들려고 PostService를 쓰므로 PostModule을 imports에 적는다.
@Module({
  imports: [PrismaModule, PostModule],
  controllers: [UserController, AdminUserController],
  providers: [UserService, UserQueryRepository],
})
export class UserApiModule {}
