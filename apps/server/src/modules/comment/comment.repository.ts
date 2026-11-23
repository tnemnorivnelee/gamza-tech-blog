import { Injectable } from '@nestjs/common';
import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import type { PageRequest, SortOrder } from '../../common/pageable.js';
import type { Prisma } from '../../infra/prisma/generated/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

// 내 댓글 목록의 한 줄에 필요한 값이다. Prisma의 타입(BigInt 등)은 이 파일 안에서 끝내고 밖으로는 일반 값만 내보낸다.
export interface MyCommentSummary {
  readonly commentId: number;
  readonly content: string;
  // DB의 서울 벽시계 값을 Date의 UTC 필드로 읽은 것이다(docs/m4-prisma-plan.md 11절).
  readonly createdAt: Date;
  readonly postId: number;
  readonly postTitle: string;
}

export interface MyCommentPage {
  readonly comments: MyCommentSummary[];
  readonly totalElements: number;
}

// 요청의 sort가 쓰는 이름(옛 Comment 엔티티의 필드)과 Prisma 필드의 짝이다. 엔티티의 id가 commentId 컬럼이라 응답 이름(commentId)으로는 정렬할 수 없다.
// shortcut: 연관 정렬(post, user 등)은 옮기지 않는다. 옛 서버는 받았지만 프론트는 createdAt,desc만 쓴다. 필요해지면 더한다.
const SORT_FIELDS = {
  id: 'commentId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  content: 'content',
} as const;

// 옛 메서드 이름(findByUserOrderByCreatedAtDesc)의 정렬이 먼저 오고 요청의 sort(없으면 기본 createdAt desc)가 뒤에 붙는다
// (Spring Data의 AbstractQueryCreator: tree.getSort().and(dynamicSort), 3.4.0 소스로 확인). 그래서 createdAt 내림차순이 항상 첫 키이고,
// 요청의 sort는 같은 시각 안에서만 순서를 정한다. 소개 목록(요청의 sort가 통째로 바꾼다)과 다르다.
// 허용 목록에 없는 속성은 500 C004다(소개 목록과 같다). 같은 값의 순서는 옛 쿼리가 정하지 않아 commentId 내림차순으로 마무리한다.
function toOrderBy(
  orders: readonly SortOrder[],
): Prisma.CommentOrderByWithRelationInput[] {
  const requested: Prisma.CommentOrderByWithRelationInput[] = orders.map(
    ({ property, direction }) => {
      if (!Object.hasOwn(SORT_FIELDS, property))
        throw new BusinessException(ErrorCode.INTERNAL_SERVER_ERROR);
      return { [SORT_FIELDS[property as keyof typeof SORT_FIELDS]]: direction };
    },
  );
  return [{ createdAt: 'desc' }, ...requested, { commentId: 'desc' }];
}

// 내 댓글 목록의 MySQL 구현이다(옛 CommentRepository.findByUserOrderByCreatedAtDesc). Prisma는 이런 *.repository.ts에서만 import한다.
// 바꿔 끼울 구현이 없어서 추상 클래스 없이 클래스 하나다. 시험은 이 클래스를 진짜 MySQL로 확인한다.
@Injectable()
export class CommentRepository {
  constructor(private readonly prisma: PrismaService) {}

  // 내가 쓴 댓글 전부다. 최상위 댓글과 답글을 구분하지 않는다.
  async findMyCommentPage(
    githubId: string,
    { page, size }: PageRequest,
    orders: readonly SortOrder[],
  ): Promise<MyCommentPage> {
    const where = { user: { githubId } };
    // 옛 Spring Data의 Page는 쪽을 넘겨도 실제 전체 개수를 센다(글 목록과 다르다). 두 쿼리는 서로 기다릴 이유가 없어서 함께 보낸다.
    const [rows, totalElements] = await Promise.all([
      this.prisma.comment.findMany({
        where,
        orderBy: toOrderBy(orders),
        skip: page * size,
        take: size,
        select: {
          commentId: true,
          content: true,
          createdAt: true,
          post: { select: { postId: true, title: true } },
        },
      }),
      this.prisma.comment.count({ where }),
    ]);
    return {
      totalElements,
      comments: rows.map((row) => ({
        commentId: Number(row.commentId),
        content: row.content,
        createdAt: row.createdAt,
        postId: Number(row.post.postId),
        postTitle: row.post.title,
      })),
    };
  }
}
