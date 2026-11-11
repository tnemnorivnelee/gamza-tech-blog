import { Injectable } from '@nestjs/common';
import type { PageRequest } from '../../common/pageable.js';
import type { Prisma } from '../../infra/prisma/generated/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { CommentRow } from '../comment/comment-tree.js';

// 글 목록의 한 줄에 필요한 값이다. Prisma의 타입(BigInt 등)은 이 파일 안에서 끝내고 밖으로는 일반 값만 내보낸다.
export interface PostSummary {
  readonly postId: number;
  readonly title: string;
  readonly content: string;
  // 작성자의 닉네임
  readonly writer: string;
  readonly writerProfileImageUrl: string | null;
  // DB의 서울 벽시계 값을 Date의 UTC 필드로 읽은 것이다(docs/m4-prisma-plan.md 11절).
  readonly createdAt: Date;
  readonly tags: string[];
  readonly thumbnailImageUrl: string | null;
}

export interface PostPage {
  readonly posts: PostSummary[];
  readonly totalElements: number;
}

// 글 상세에 필요한 값이다. 댓글은 한 글의 것을 전부 평평하게 담고, 트리는 서비스가 만든다(comment-tree.ts).
export interface PostDetail {
  readonly postId: number;
  readonly title: string;
  readonly content: string;
  readonly writer: string;
  readonly writerProfileImageUrl: string | null;
  readonly githubId: string;
  readonly likesCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly tags: string[];
  // 작성 시각 내림차순(같은 시각이면 commentId 내림차순)이다.
  readonly comments: CommentRow[];
}

export interface PopularPost {
  readonly postId: number;
  readonly title: string;
  readonly writer: string;
  readonly writerProfileImageUrl: string | null;
}

// Prisma의 contains는 값을 이스케이프하지 않고 LIKE 패턴에 넣어서, 그대로 두면 %와 _가 와일드카드이고 \가 이스케이프 문자다(시험으로 확인함).
// 옛 containsIgnoreCase는 셋 다 글자 그대로 취급했으므로 앞에 \를 붙여 준다. Prisma가 이스케이프를 하게 되면 시험이 알려 준다.
const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

// 글 목록 조회의 MySQL 구현이다(옛 PostQueryAdapter). Prisma는 이런 *.repository.ts에서만 import한다.
// @Injectable: Nest가 생성자에 필요한 부품(PrismaService)을 찾아 넣어 주는 대상이라는 표시다.
// 바꿔 끼울 구현이 없어서 UserRepository와 달리 추상 클래스 없이 클래스 하나다. 시험은 이 클래스를 진짜 MySQL로 확인한다.
@Injectable()
export class PostRepository {
  constructor(private readonly prisma: PrismaService) {}

  // tags가 비어 있으면 전체, 있으면 그중 하나라도 가진 글이다(OR). 응답의 tags는 필터와 무관하게 글의 모든 태그다.
  findAllPosts(page: PageRequest, tags: string[]): Promise<PostPage> {
    return this.fetchPosts(
      page,
      tags.length > 0
        ? { postTags: { some: { tag: { tagName: { in: tags } } } } }
        : {},
    );
  }

  // 대소문자는 구분하지 않는다. 컬럼의 정렬 규칙(utf8mb4_0900_ai_ci)이 구분하지 않아서 옛 lower() 비교와 결과가 같다.
  searchPostsByTitle(page: PageRequest, keyword: string): Promise<PostPage> {
    return this.fetchPosts(page, {
      title: { contains: escapeLike(keyword) },
    });
  }

  findPostsByWriter(page: PageRequest, githubId: string): Promise<PostPage> {
    return this.fetchPosts(page, { user: { githubId } });
  }

  // 글이 없으면 null이다. 태그는 연결한 순서(postTagId)다. 옛 코드는 순서를 정하지 않았고 DB가 기본 키 순서로 줬다 [추정].
  async findPostDetail(postId: bigint): Promise<PostDetail | null> {
    const row = await this.prisma.post.findUnique({
      where: { postId },
      select: {
        postId: true,
        title: true,
        content: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            nickname: true,
            githubId: true,
            profileImages: { select: { profileImageUrl: true }, take: 1 },
          },
        },
        postTags: {
          select: { tag: { select: { tagName: true } } },
          orderBy: { postTagId: 'asc' },
        },
        // 옛 쿼리는 최상위 댓글만 작성 시각 내림차순으로 가져왔다. 답글까지 한 번에 읽고 트리는 서비스가 만든다.
        // 같은 시각의 순서는 옛 쿼리가 정하지 않았다. commentId 내림차순으로 마무리한다.
        comments: {
          select: {
            commentId: true,
            parentCommentId: true,
            content: true,
            createdAt: true,
            user: {
              select: {
                nickname: true,
                profileImages: { select: { profileImageUrl: true }, take: 1 },
              },
            },
          },
          orderBy: [{ createdAt: 'desc' }, { commentId: 'desc' }],
        },
        _count: { select: { likes: true } },
      },
    });
    if (!row) return null;

    return {
      postId: Number(row.postId),
      title: row.title,
      content: row.content,
      writer: row.user.nickname,
      writerProfileImageUrl: row.user.profileImages[0]?.profileImageUrl ?? null,
      githubId: row.user.githubId,
      likesCount: row._count.likes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      tags: row.postTags.map((postTag) => postTag.tag.tagName),
      comments: row.comments.map((comment) => ({
        commentId: Number(comment.commentId),
        parentCommentId:
          comment.parentCommentId === null
            ? null
            : Number(comment.parentCommentId),
        writer: comment.user.nickname,
        writerProfileImageUrl:
          comment.user.profileImages[0]?.profileImageUrl ?? null,
        content: comment.content,
        createdAt: comment.createdAt,
      })),
    };
  }

  // since보다 늦게 쓴 글 중 좋아요가 많은 순으로 limit개다. 좋아요가 0개인 글도 후보다(옛 쿼리는 left join).
  // 좋아요 수가 같으면 최신 글이 먼저다. 그래도 같으면 postId 내림차순으로 마무리한다(옛 쿼리는 정하지 않았다).
  async findWeeklyPopularPosts(
    since: Date,
    limit: number,
  ): Promise<PopularPost[]> {
    const rows = await this.prisma.post.findMany({
      where: { createdAt: { gt: since } },
      orderBy: [
        { likes: { _count: 'desc' } },
        { createdAt: 'desc' },
        { postId: 'desc' },
      ],
      take: limit,
      select: {
        postId: true,
        title: true,
        user: {
          select: {
            nickname: true,
            profileImages: { select: { profileImageUrl: true }, take: 1 },
          },
        },
      },
    });
    return rows.map((row) => ({
      postId: Number(row.postId),
      title: row.title,
      writer: row.user.nickname,
      writerProfileImageUrl: row.user.profileImages[0]?.profileImageUrl ?? null,
    }));
  }

  private async fetchPosts(
    { page, size }: PageRequest,
    where: Prisma.PostWhereInput,
  ): Promise<PostPage> {
    const rows = await this.prisma.post.findMany({
      where,
      // 정렬은 작성 시각 내림차순으로 고정이다(요청의 sort는 무시한다. 옛 동작).
      // 옛 쿼리는 같은 시각의 순서를 정하지 않았다. 쪽을 넘길 때 순서가 흔들리지 않도록 postId로 마무리한다.
      orderBy: [{ createdAt: 'desc' }, { postId: 'desc' }],
      skip: page * size,
      take: size,
      select: {
        postId: true,
        title: true,
        content: true,
        createdAt: true,
        user: {
          select: {
            nickname: true,
            // 옛 User는 프로필 이미지를 하나만 가진다(@OneToOne). DB에도 둘 이상 가진 사용자가 없다.
            profileImages: { select: { profileImageUrl: true }, take: 1 },
          },
        },
        postTags: {
          select: { tag: { select: { tagName: true } } },
          orderBy: { postTagId: 'asc' },
        },
        // 썸네일은 글의 이미지 중 id가 가장 작은 것(맨 처음 올린 것)이다.
        postImages: {
          select: { imageUrl: true },
          orderBy: { postImageId: 'asc' },
          take: 1,
        },
      },
    });

    // 옛 코드는 이 쪽이 비면 개수를 세지 않고 0으로 돌려준다(PageImpl(List.of(), pageable, 0)).
    // 그래서 범위를 넘긴 쪽을 요청하면 글이 있어도 totalElements와 totalPages가 0이다.
    if (rows.length === 0) return { posts: [], totalElements: 0 };

    const totalElements = await this.prisma.post.count({ where });
    return {
      totalElements,
      posts: rows.map((row) => ({
        postId: Number(row.postId),
        title: row.title,
        content: row.content,
        writer: row.user.nickname,
        writerProfileImageUrl:
          row.user.profileImages[0]?.profileImageUrl ?? null,
        createdAt: row.createdAt,
        tags: row.postTags.map((postTag) => postTag.tag.tagName),
        thumbnailImageUrl: row.postImages[0]?.imageUrl ?? null,
      })),
    };
  }
}
