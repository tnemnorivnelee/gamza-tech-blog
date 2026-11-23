import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module.js';
import { CommentController } from './comment.controller.js';
import { CommentRepository } from './comment.repository.js';
import { CommentService } from './comment.service.js';

// 댓글 기능 하나를 묶는 모듈이다(옛 domain/comment). CommentRepository가 PrismaService를 필요로 해서 PrismaModule을 imports에 적는다.
@Module({
  imports: [PrismaModule],
  controllers: [CommentController],
  providers: [CommentService, CommentRepository],
})
export class CommentModule {}
