import { Module } from '@nestjs/common';
import { ReadCacheModule } from '../../common/read-cache.module.js';
import { PrismaModule } from '../../infra/prisma/prisma.module.js';
import { CommentController } from './comment.controller.js';
import { CommentRepository } from './comment.repository.js';
import { CommentService } from './comment.service.js';

// 댓글 기능 하나를 묶는 모듈이다(옛 domain/comment). CommentRepository가 PrismaService를, CommentService가 읽기 캐시(ReadCache)를 필요로 해서 PrismaModule과 ReadCacheModule을 imports에 적는다.
@Module({
  imports: [PrismaModule, ReadCacheModule],
  controllers: [CommentController],
  providers: [CommentService, CommentRepository],
})
export class CommentModule {}
