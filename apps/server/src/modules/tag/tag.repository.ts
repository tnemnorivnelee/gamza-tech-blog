import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

// 태그 조회의 MySQL 구현이다(옛 TagJpaRepository). Prisma는 이런 *.repository.ts에서만 import한다.
@Injectable()
export class TagRepository {
  constructor(private readonly prisma: PrismaService) {}

  // 이름 오름차순이다. 순서는 DB의 정렬 규칙(utf8mb4_0900_ai_ci)이 정한다: 옛 order by t.tagName과 같은 MySQL이 같은 규칙으로 센다.
  // 글에 연결되지 않은 태그도 나온다(옛 쿼리도 걸러내지 않았다).
  async findAllTagNames(): Promise<string[]> {
    const rows = await this.prisma.tag.findMany({
      select: { tagName: true },
      orderBy: { tagName: 'asc' },
    });
    return rows.map((row) => row.tagName);
  }
}
