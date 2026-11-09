import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

// PrismaService 하나를 만들어 다른 모듈에 내주는 모듈이다(RedisModule과 같은 역할). 쓰려는 모듈은 imports에 이 모듈을 적는다.
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
