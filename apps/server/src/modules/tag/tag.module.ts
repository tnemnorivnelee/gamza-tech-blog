import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module.js';
import { TagController } from './tag.controller.js';
import { TagRepository } from './tag.repository.js';
import { TagService } from './tag.service.js';

// exports: 다른 모듈(PostModule)이 TagService를 주입받아 쓸 수 있게 내보낸다. 내보내지 않은 부품은 이 모듈 안에서만 보인다.
@Module({
  imports: [PrismaModule],
  controllers: [TagController],
  providers: [TagService, TagRepository],
  exports: [TagService],
})
export class TagModule {}
