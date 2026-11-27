import { Injectable } from '@nestjs/common';
import { kstWallClockNow } from '../../common/local-date-time.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

export interface UserWithImage {
  readonly userId: bigint;
  // 이미지가 없으면 null이다. 옛 User는 프로필 이미지를 하나만 가진다(@OneToOne).
  readonly imageUrl: string | null;
}

// 프로필 이미지 행의 MySQL 구현이다(옛 ProfileImageRepositoryImpl과 User.profileImage의 연쇄·고아 삭제).
// 옛 JPA는 User의 연결만 바꾸면 이전 행을 지우고(orphanRemoval) 새 행을 넣었다. 여기서는 그 둘을 한 트랜잭션에 직접 한다.
// users 행은 건드리지 않는다(연결의 주인이 profile_images라서 옛 User도 바뀌지 않았다).
@Injectable()
export class ProfileImageRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUserWithImage(githubId: string): Promise<UserWithImage | null> {
    const row = await this.prisma.user.findUnique({
      where: { githubId },
      select: {
        userId: true,
        profileImages: { select: { profileImageUrl: true }, take: 1 },
      },
    });
    return row
      ? {
          userId: row.userId,
          imageUrl: row.profileImages[0]?.profileImageUrl ?? null,
        }
      : null;
  }

  // 이전 행을 모두 지우고 새 행 하나를 넣는다. 둘 중 하나가 실패하면 아무것도 바뀌지 않는다.
  replaceImage(
    userId: bigint,
    imageUrl: string,
  ): Promise<{ id: bigint; imageUrl: string }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.profileImage.deleteMany({ where: { userId } });
      const now = kstWallClockNow();
      const created = await tx.profileImage.create({
        data: {
          userId,
          profileImageUrl: imageUrl,
          createdAt: now,
          updatedAt: now,
        },
      });
      return { id: created.profileImageId, imageUrl: created.profileImageUrl };
    });
  }

  async deleteImages(userId: bigint): Promise<void> {
    await this.prisma.profileImage.deleteMany({ where: { userId } });
  }
}
