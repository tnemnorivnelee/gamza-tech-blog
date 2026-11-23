import { Injectable } from '@nestjs/common';
import type { PageRequest } from '../../common/pageable.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

// 좋아요 목록의 한 줄에 필요한 값이다. Prisma의 타입(BigInt 등)은 이 파일 안에서 끝내고 밖으로는 일반 값만 내보낸다.
export interface LikeSummary {
  readonly likeId: number;
  readonly postId: number;
  readonly title: string;
  readonly content: string;
  // 글 작성자의 닉네임
  readonly writer: string;
  readonly writerProfileImageUrl: string | null;
  readonly thumbnailImageUrl: string | null;
  // 좋아요를 누른 시각이다. DB의 서울 벽시계 값을 Date의 UTC 필드로 읽은 것이다(docs/m4-prisma-plan.md 11절).
  readonly createdAt: Date;
  // 태그가 없는 글은 [null]이다. 옛 코드가 왼쪽 조인의 null을 걸러내지 않아서 생긴 결과를 그대로 옮긴다(docs/m5-read-api-plan.md 3.9).
  readonly tags: (string | null)[];
}

export interface LikePage {
  readonly likes: LikeSummary[];
  readonly totalElements: number;
}

// 좋아요의 MySQL 구현이다(옛 LikeQueryAdapter와 LikeRepository.existsByUserAndPost). Prisma는 이런 *.repository.ts에서만 import한다.
// 바꿔 끼울 구현이 없어서 추상 클래스 없이 클래스 하나다. 시험은 이 클래스를 진짜 MySQL로 확인한다.
@Injectable()
export class LikeRepository {
  constructor(private readonly prisma: PrismaService) {}

  // 내가 누른 좋아요를 누른 시각 내림차순으로 준다. 같은 시각이면 likeId 오름차순이다(옛 쿼리가 둘 다 적었다).
  // 요청의 sort는 쓰지 않는다. 옛 어댑터가 pageable의 정렬을 읽지 않았다.
  async findMyLikePage(
    githubId: string,
    { page, size }: PageRequest,
  ): Promise<LikePage> {
    const where = { user: { githubId } };
    // 옛 Page는 쪽을 넘겨도 실제 전체 개수를 센다(글 목록과 다르다). 두 쿼리는 서로 기다릴 이유가 없어서 함께 보낸다.
    const [rows, totalElements] = await Promise.all([
      this.prisma.like.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { likeId: 'asc' }],
        skip: page * size,
        take: size,
        select: {
          likeId: true,
          createdAt: true,
          post: {
            select: {
              postId: true,
              title: true,
              content: true,
              user: {
                select: {
                  nickname: true,
                  // 옛 User는 프로필 이미지를 하나만 가진다(@OneToOne). DB에도 둘 이상 가진 사용자가 없다.
                  profileImages: { select: { profileImageUrl: true }, take: 1 },
                },
              },
              // 옛 쿼리는 태그의 순서를 정하지 않았다. 글 목록처럼 붙인 순서(postTagId)로 둔다.
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
          },
        },
      }),
      this.prisma.like.count({ where }),
    ]);

    return {
      totalElements,
      likes: rows.map(({ likeId, createdAt, post }) => {
        // 같은 태그가 두 번 붙은 글도 한 번만 나온다(옛 distinct()). 하나도 없으면 [null]이다.
        const names = [...new Set(post.postTags.map((pt) => pt.tag.tagName))];
        return {
          likeId: Number(likeId),
          postId: Number(post.postId),
          title: post.title,
          content: post.content,
          writer: post.user.nickname,
          writerProfileImageUrl:
            post.user.profileImages[0]?.profileImageUrl ?? null,
          thumbnailImageUrl: post.postImages[0]?.imageUrl ?? null,
          createdAt,
          tags: names.length > 0 ? names : [null],
        };
      }),
    };
  }

  // 글이 없으면 null, 있으면 내가 좋아요를 눌렀는지다. 옛 코드는 글을 먼저 찾고(없으면 404) 좋아요 행을 따로 확인했다.
  // 같은 글에 같은 사용자의 좋아요 행이 여럿(33번)이어도 하나라도 있으면 true다.
  async isPostLikedBy(
    githubId: string,
    postId: bigint,
  ): Promise<boolean | null> {
    const post = await this.prisma.post.findUnique({
      where: { postId },
      select: {
        likes: {
          where: { user: { githubId } },
          select: { likeId: true },
          take: 1,
        },
      },
    });
    return post === null ? null : post.likes.length > 0;
  }
}
