import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

// 내 프로필 한 건에 필요한 값이다. Prisma의 타입(BigInt, enum 등)은 이 파일 안에서 끝내고 밖으로는 일반 값만 내보낸다.
export interface UserProfile {
  readonly githubId: string;
  readonly nickname: string;
  readonly name: string;
  readonly email: string | null;
  readonly profileImageUrl: string | null;
  // 옛 enum의 이름이다(BACKEND 등). 가입 화면을 끝내기 전에는 비어 있다.
  readonly position: string | null;
  readonly role: string;
  readonly studentNumber: string | null;
  readonly gamjaBatch: number | null;
  // DB의 서울 벽시계 값을 Date의 UTC 필드로 읽은 것이다(docs/m4-prisma-plan.md 11절).
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// 공개 프로필의 윗부분이다. githubId는 응답에 싣지 않고, 이 사람의 글과 활동을 찾는 데 쓴다.
export interface PublicProfile {
  readonly githubId: string;
  readonly nickname: string;
  readonly gamjaBatch: number | null;
  readonly profileImageUrl: string | null;
}

export interface ActivityCounts {
  readonly likedPostCount: number;
  readonly writtenPostCount: number;
  readonly writtenCommentCount: number;
}

export interface PendingUser {
  readonly userId: number;
  readonly gamjaBatch: number | null;
  readonly name: string;
  readonly position: string | null;
}

// 사용자 읽기 조회의 MySQL 구현이다(옛 UserRepository의 읽기 부분과 Like/Post/CommentRepository의 countByUser).
// 로그인과 가드가 쓰는 UserRepository(바꿔 끼우는 인터페이스)와 따로 둔다. 활동 개수는 글·좋아요·댓글 테이블에 걸쳐 있어서
// 인메모리 가짜로 흉내 내기보다 이 클래스를 진짜 MySQL로 확인하는 편이 낫다. Prisma는 이런 *.repository.ts에서만 import한다.
@Injectable()
export class UserQueryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findProfileByGithubId(githubId: string): Promise<UserProfile | null> {
    const row = await this.prisma.user.findUnique({
      where: { githubId },
      select: {
        githubId: true,
        nickname: true,
        name: true,
        email: true,
        position: true,
        role: true,
        studentNumber: true,
        gamjaBatch: true,
        createdAt: true,
        updatedAt: true,
        // 옛 User는 프로필 이미지를 하나만 가진다(@OneToOne). DB에도 둘 이상 가진 사용자가 없다.
        profileImages: { select: { profileImageUrl: true }, take: 1 },
      },
    });
    if (!row) return null;
    const { profileImages, ...profile } = row;
    return {
      ...profile,
      profileImageUrl: profileImages[0]?.profileImageUrl ?? null,
    };
  }

  // 닉네임 비교는 컬럼의 정렬 규칙(utf8mb4_0900_ai_ci)을 따라서 대소문자와 악센트를 구분하지 않는다. 옛 findByNickname과 같다.
  // 응답에는 찾은 사용자의 저장된 닉네임이 나간다(요청 값이 아니다).
  async findPublicProfileByNickname(
    nickname: string,
  ): Promise<PublicProfile | null> {
    const row = await this.prisma.user.findUnique({
      where: { nickname },
      select: {
        githubId: true,
        nickname: true,
        gamjaBatch: true,
        profileImages: { select: { profileImageUrl: true }, take: 1 },
      },
    });
    if (!row) return null;
    return {
      githubId: row.githubId,
      nickname: row.nickname,
      gamjaBatch: row.gamjaBatch,
      profileImageUrl: row.profileImages[0]?.profileImageUrl ?? null,
    };
  }

  // 행 수를 센다: 좋아요 행(같은 글에 여러 번 눌렀어도 행마다 센다), 쓴 글, 쓴 댓글(대댓글 포함). 없는 사용자는 0이다(옛 countByUser와 같다).
  async countActivity(githubId: string): Promise<ActivityCounts> {
    const user = { user: { githubId } };
    const [likedPostCount, writtenPostCount, writtenCommentCount] =
      await Promise.all([
        this.prisma.like.count({ where: user }),
        this.prisma.post.count({ where: user }),
        this.prisma.comment.count({ where: user }),
      ]);
    return { likedPostCount, writtenPostCount, writtenCommentCount };
  }

  // 옛 findAllByRole은 순서를 정하지 않았다. 기본 키 순서(가입 순)로 짐작해 userId 오름차순으로 둔다 [추정].
  async findPendingUsers(): Promise<PendingUser[]> {
    const rows = await this.prisma.user.findMany({
      where: { role: 'PENDING' },
      orderBy: { userId: 'asc' },
      select: { userId: true, gamjaBatch: true, name: true, position: true },
    });
    return rows.map((row) => ({ ...row, userId: Number(row.userId) }));
  }
}
