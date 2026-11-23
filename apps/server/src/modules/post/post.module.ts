import { Module } from '@nestjs/common';
import { ReadCacheModule } from '../../common/read-cache.module.js';
import { PrismaModule } from '../../infra/prisma/prisma.module.js';
import { TagModule } from '../tag/tag.module.js';
import { PostController } from './post.controller.js';
import { PostRepository } from './post.repository.js';
import { PostService } from './post.service.js';

// 글 조회 기능 하나를 묶는 모듈이다. controllers는 라우트를 맡는 클래스, providers는 Nest가 만들어 주입해 줄 부품이다.
// PostRepository가 PrismaService를, 홈 피드가 TagService를, 읽기 캐시가 ReadCache를 필요로 해서 PrismaModule, TagModule, ReadCacheModule을 imports에 적는다.
// exports: 공개 프로필(UserModule)이 그 사용자의 글 목록을 PostService로 만든다.
@Module({
  imports: [PrismaModule, TagModule, ReadCacheModule],
  controllers: [PostController],
  providers: [PostService, PostRepository],
  exports: [PostService],
})
export class PostModule {}
