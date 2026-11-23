import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module.js';
import { LikeController } from './like.controller.js';
import { LikeRepository } from './like.repository.js';
import { LikeService } from './like.service.js';

// 좋아요 기능 하나를 묶는 모듈이다(옛 domain/like). LikeRepository가 PrismaService를 필요로 해서 PrismaModule을 imports에 적는다.
@Module({
  imports: [PrismaModule],
  controllers: [LikeController],
  providers: [LikeService, LikeRepository],
})
export class LikeModule {}
