import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { type NewUser, type User, UserRepository } from './user.repository.js';

// DB의 DATETIME에는 시간대 정보가 없다. 옛 서버는 한국 시간(KST) 벽시계 값을 그대로 넣었다(docs/m4-prisma-plan.md 4절, D7).
// Prisma 어댑터는 Date의 UTC 필드를 그대로 DATETIME에 쓰고 읽는다(프로세스의 시간대와 무관하다). 그래서 KST 벽시계 값을 쓰려면
// UTC 필드가 KST 시각이 되도록 9시간을 더한 Date를 넘긴다. 쓰는 repository가 둘 이상이 되면(M6) 공용으로 뽑는다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const kstWallClockNow = () => new Date(Date.now() + KST_OFFSET_MS);

// UserRepository의 MySQL 구현이다(옛 UserRepository + UserServiceImpl의 DB 접근). Prisma는 이런 *.repository.ts에서만 import한다.
// 닉네임·이메일·githubId가 겹치면 DB의 unique 제약이 거부하고 예외가 그대로 올라간다(옛 JPA와 같다. 인메모리 구현에는 이 검사가 없었다).
@Injectable()
export class PrismaUserRepository extends UserRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findByGithubId(githubId: string): Promise<User | undefined> {
    // select: 가드와 로그인이 쓰는 세 컬럼만 읽는다. 없으면 null이라서 undefined로 바꾼다.
    const row = await this.prisma.user.findUnique({
      where: { githubId },
      select: { githubId: true, role: true, email: true },
    });
    return row ?? undefined;
  }

  async create(user: NewUser): Promise<void> {
    // created_at·updated_at은 DB 기본값이 없어서 코드가 채운다(옛 @CreatedDate·@LastModifiedDate).
    const now = kstWallClockNow();
    await this.prisma.user.create({
      data: {
        githubId: user.githubId,
        role: user.role,
        email: user.email,
        name: user.name,
        nickname: user.nickname,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  // 공백만 있는 이메일도 비어 있는 것으로 본다(옛 StringUtils.hasText와 같다). 없는 사용자는 아무것도 하지 않는다.
  // "비어 있을 때만"을 읽고 쓰기 두 번으로 나누면 그 사이에 다른 요청이 채울 수 있어서 한 문장으로 쓴다.
  // 이 한 곳에서만 SQL을 직접 쓴다($executeRaw는 태그드 템플릿이라 값은 자리표시자로 따로 전달된다).
  async updateEmailIfEmpty(githubId: string, email: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE users SET email = ${email}, updated_at = ${kstWallClockNow()}
      WHERE github_id = ${githubId} AND (email IS NULL OR TRIM(email) = '')`;
  }
}
