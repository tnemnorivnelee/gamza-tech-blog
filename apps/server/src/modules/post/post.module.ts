import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module.js';
import { PostController } from './post.controller.js';
import { PostRepository } from './post.repository.js';
import { PostService } from './post.service.js';

// 글 조회 기능 하나를 묶는 모듈이다. controllers는 라우트를 맡는 클래스, providers는 Nest가 만들어 주입해 줄 부품이다.
// PostRepository가 PrismaService를 필요로 해서 PrismaModule을 imports에 적는다.
@Module({
  imports: [PrismaModule],
  controllers: [PostController],
  providers: [PostService, PostRepository],
})
export class PostModule {}
