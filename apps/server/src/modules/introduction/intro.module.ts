import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module.js';
import { IntroController } from './intro.controller.js';
import { IntroRepository } from './intro.repository.js';
import { IntroService } from './intro.service.js';

// 소개 조회 기능 하나를 묶는 모듈이다. IntroRepository가 PrismaService를 필요로 해서 PrismaModule을 imports에 적는다.
@Module({
  imports: [PrismaModule],
  controllers: [IntroController],
  providers: [IntroService, IntroRepository],
})
export class IntroModule {}
