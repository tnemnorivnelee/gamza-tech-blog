import { Injectable } from '@nestjs/common';
import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import type { PageRequest, SortOrder } from '../../common/pageable.js';
import type { Prisma } from '../../infra/prisma/generated/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

// 소개 목록의 한 줄에 필요한 값이다. Prisma의 타입(BigInt 등)은 이 파일 안에서 끝내고 밖으로는 일반 값만 내보낸다.
export interface IntroSummary {
  readonly introId: number;
  readonly userId: number;
  // 작성자의 닉네임
  readonly nickname: string;
  readonly profileImageUrl: string | null;
  readonly content: string;
  // DB의 서울 벽시계 값을 Date의 UTC 필드로 읽은 것이다(docs/m4-prisma-plan.md 11절).
  readonly createdAt: Date;
}

export interface IntroPage {
  readonly intros: IntroSummary[];
  readonly totalElements: number;
}

// 요청의 sort가 쓰는 이름(옛 Introduction 엔티티의 필드)과 Prisma 필드의 짝이다. 엔티티의 id가 introId 컬럼이라 응답 이름(introId)으로는 정렬할 수 없다.
// shortcut: 연관 정렬(user.nickname 등)은 옮기지 않는다. 옛 서버는 정렬됐지만 프론트는 createdAt,desc만 쓴다. 필요해지면 더한다.
const SORT_FIELDS = {
  id: 'introId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  content: 'content',
} as const;

// 허용 목록에 없는 속성은 500 C004다. 옛 Spring Data는 없는 속성으로 정렬하면 PropertyReferenceException을 던졌고,
// 옛 예외 처리기는 이것을 따로 다루지 않아 마지막 처리기가 500으로 보냈다 [추정, docs/m5-read-api-plan.md 3.1].
// 옛 쿼리는 같은 값의 순서를 정하지 않았다. 쪽을 넘길 때 순서가 흔들리지 않도록 introId 내림차순으로 마무리한다.
function toOrderBy(
  orders: readonly SortOrder[],
): Prisma.IntroductionOrderByWithRelationInput[] {
  const orderBy: Prisma.IntroductionOrderByWithRelationInput[] = orders.map(
    ({ property, direction }) => {
      if (!Object.hasOwn(SORT_FIELDS, property))
        throw new BusinessException(ErrorCode.INTERNAL_SERVER_ERROR);
      return { [SORT_FIELDS[property as keyof typeof SORT_FIELDS]]: direction };
    },
  );
  return [...orderBy, { introId: 'desc' }];
}

// 소개 목록의 MySQL 구현이다(옛 IntroductionRepository.findAll(pageable)). Prisma는 이런 *.repository.ts에서만 import한다.
// 바꿔 끼울 구현이 없어서 추상 클래스 없이 클래스 하나다. 시험은 이 클래스를 진짜 MySQL로 확인한다.
@Injectable()
export class IntroRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findIntroPage(
    { page, size }: PageRequest,
    orders: readonly SortOrder[],
  ): Promise<IntroPage> {
    // 옛 Spring Data의 Page는 쪽을 넘겨도 실제 전체 개수를 센다(글 목록과 다르다). 두 쿼리는 서로 기다릴 이유가 없어서 함께 보낸다.
    const [rows, totalElements] = await Promise.all([
      this.prisma.introduction.findMany({
        orderBy: toOrderBy(orders),
        skip: page * size,
        take: size,
        select: {
          introId: true,
          content: true,
          createdAt: true,
          user: {
            select: {
              userId: true,
              nickname: true,
              // 옛 User는 프로필 이미지를 하나만 가진다(@OneToOne). DB에도 둘 이상 가진 사용자가 없다.
              profileImages: { select: { profileImageUrl: true }, take: 1 },
            },
          },
        },
      }),
      this.prisma.introduction.count(),
    ]);
    return {
      totalElements,
      intros: rows.map((row) => ({
        introId: Number(row.introId),
        userId: Number(row.user.userId),
        nickname: row.user.nickname,
        profileImageUrl: row.user.profileImages[0]?.profileImageUrl ?? null,
        content: row.content,
        createdAt: row.createdAt,
      })),
    };
  }
}
