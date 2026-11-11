import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from './common/common.module.js';
import { validateEnv } from './config/env.validation.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { PostModule } from './modules/post/post.module.js';
import { TagModule } from './modules/tag/tag.module.js';
import { UserModule } from './modules/user/user.module.js';

// 앱의 뿌리 모듈. Nest는 기능을 모듈 단위로 묶고, imports에 적은 모듈이 앱에 붙는다.
@Module({
  imports: [
    // 부팅 때 환경변수를 읽어 validateEnv로 검증한다. isGlobal이라 어느 모듈에서든 ConfigService로 값을 꺼낸다.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    CommonModule, // 전역 예외 필터
    AuthModule, // 토큰 발급·검증
    UserModule, // 사용자 조회
    PostModule, // 글 목록·상세·인기·홈 피드 조회
    TagModule, // 태그 목록 조회
  ],
})
export class AppModule {}
