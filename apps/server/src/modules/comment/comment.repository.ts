import { Injectable } from '@nestjs/common';
import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import { kstWallClockNow } from '../../common/local-date-time.js';
import type { PageRequest, SortOrder } from '../../common/pageable.js';
import type { Prisma } from '../../infra/prisma/generated/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { CommentRow } from './comment-tree.js';

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

// 댓글 쓰기와 지우기의 결과다. 서비스가 이것을 보고 어떤 오류를 던질지 정한다(옛 PostValidator와 CommentValidator의 검사 순서와 같다).
export type CreateCommentResult =
  | { readonly status: 'POST_NOT_FOUND' }
  | { readonly status: 'PARENT_NOT_FOUND' }
  | { readonly status: 'PARENT_OF_OTHER_POST' }
  | { readonly status: 'CREATED'; readonly comment: CommentRow };

export type DeleteCommentResult =
  | { readonly status: 'COMMENT_NOT_FOUND' }
  | { readonly status: 'FORBIDDEN' }
  | { readonly status: 'DELETED'; readonly postId: number };

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

  // 댓글을 쓴다. 검사 순서는 옛 createComment와 같다: 글이 있는지, 부모 댓글이 있는지, 부모가 이 글의 댓글인지.
  // content는 검사하지 않는다(옛 컨트롤러에 @Valid가 없다). 비어 있거나 길어도 저장하고, 아예 없으면 DB의 NOT NULL이 막아 500이다.
  async createComment(
    githubId: string,
    postId: bigint,
    content: string,
    parentCommentId: bigint | null,
  ): Promise<CreateCommentResult> {
    const post = await this.prisma.post.findUnique({
      where: { postId },
      select: { postId: true },
    });
    if (post === null) return { status: 'POST_NOT_FOUND' };
    if (parentCommentId !== null) {
      const parent = await this.prisma.comment.findUnique({
        where: { commentId: parentCommentId },
        select: { postId: true },
      });
      if (parent === null) return { status: 'PARENT_NOT_FOUND' };
      if (parent.postId !== postId) return { status: 'PARENT_OF_OTHER_POST' };
    }
    // created_at·updated_at은 DB 기본값이 없어서 코드가 채운다(옛 BaseTime의 @CreatedDate·@LastModifiedDate).
    const now = kstWallClockNow();
    const row = await this.prisma.comment.create({
      data: {
        content,
        createdAt: now,
        updatedAt: now,
        user: { connect: { githubId } },
        post: { connect: { postId } },
        ...(parentCommentId === null
          ? {}
          : { parent: { connect: { commentId: parentCommentId } } }),
      },
      select: {
        commentId: true,
        parentCommentId: true,
        content: true,
        createdAt: true,
        user: {
          select: {
            nickname: true,
            // 옛 User는 프로필 이미지를 하나만 가진다(@OneToOne). DB에도 둘 이상 가진 사용자가 없다.
            profileImages: { select: { profileImageUrl: true }, take: 1 },
          },
        },
      },
    });
    return {
      status: 'CREATED',
      comment: {
        commentId: Number(row.commentId),
        parentCommentId:
          row.parentCommentId === null ? null : Number(row.parentCommentId),
        writer: row.user.nickname,
        writerProfileImageUrl:
          row.user.profileImages[0]?.profileImageUrl ?? null,
        content: row.content,
        createdAt: row.createdAt,
      },
    };
  }

  // 댓글을 지운다. 없으면 COMMENT_NOT_FOUND, 쓴 사람이 아니면 FORBIDDEN이다(ADMIN도 남의 댓글은 못 지운다. 옛 검사가 사용자만 비교한다).
  // 옛 JPA는 cascade = ALL로 답글도 함께 지웠다. DB의 외래키는 "딸린 행이 있으면 막는" 규칙이라, 가장 깊은 답글부터 한 층씩 지운다.
  // 한 문장으로 지우면 부모가 자식보다 먼저 지워질 때 막힌다. 모으는 것과 지우는 것을 한 트랜잭션에 둔다.
  async deleteComment(
    githubId: string,
    commentId: bigint,
  ): Promise<DeleteCommentResult> {
    const comment = await this.prisma.comment.findUnique({
      where: { commentId },
      select: { postId: true, user: { select: { githubId: true } } },
    });
    if (comment === null) return { status: 'COMMENT_NOT_FOUND' };
    if (comment.user.githubId !== githubId) return { status: 'FORBIDDEN' };

    await this.prisma.$transaction(async (tx) => {
      const levels: bigint[][] = [[commentId]];
      for (;;) {
        const children = await tx.comment.findMany({
          where: { parentCommentId: { in: levels[levels.length - 1] } },
          select: { commentId: true },
        });
        if (children.length === 0) break;
        levels.push(children.map((child) => child.commentId));
      }
      for (const level of levels.toReversed())
        await tx.comment.deleteMany({ where: { commentId: { in: level } } });
    });
    return { status: 'DELETED', postId: Number(comment.postId) };
  }
}
