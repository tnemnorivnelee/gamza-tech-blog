import { Injectable } from '@nestjs/common';
import { kstWallClockNow } from '../../common/local-date-time.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { ProfileFields } from './dto/profile-request.js';
import {
  PROFILE_SELECT,
  toUserProfile,
  type UserProfile,
} from './user-query.repository.js';

// 프로필 완성·수정의 결과다. 서비스가 상태를 BusinessException으로 바꾼다.
// 멤버마다 status 값이 하나라서 TS가 상태를 보고 안의 값을 좁혀 준다.
export type ProfileWriteResult =
  | { readonly status: 'USER_NOT_FOUND' }
  | { readonly status: 'UPDATED'; readonly profile: UserProfile };

export type ApproveResult =
  | { readonly status: 'USER_NOT_FOUND' }
  | { readonly status: 'NOT_PENDING' }
  | { readonly status: 'APPROVED' };

// 사용자 쓰기의 MySQL 구현이다(옛 UserServiceImpl의 setupUserProfile·updateProfile과 AdminUserServiceImpl의 approveUserProfile).
// 로그인과 가드가 쓰는 UserRepository(바꿔 끼우는 인터페이스)에 더하지 않고 따로 둔다: 거기에 더하면 인메모리 가짜도 같이 구현해야 한다.
// Prisma에는 updated_at 자동 갱신이 없어서(옛 JPA 감사 기능 대신) 쓸 때마다 직접 채운다.
@Injectable()
export class UserWriteRepository {
  constructor(private readonly prisma: PrismaService) {}

  // 옛 existsByStudentNumber. 비교는 컬럼의 정렬 규칙을 따른다(옛 JPA의 where student_number = ? 와 같다).
  async existsByStudentNumber(studentNumber: string): Promise<boolean> {
    return (await this.prisma.user.count({ where: { studentNumber } })) > 0;
  }

  // 옛 completeProfile(MapStruct)은 요청의 네 칸을 그대로 덮어쓴다. 이메일이 null이면 있던 이메일도 비운다.
  // 저장하면 role이 PENDING이 된다(옛 user.setUserRole(PENDING)).
  completeProfile(
    githubId: string,
    fields: ProfileFields,
  ): Promise<ProfileWriteResult> {
    return this.writeProfile(githubId, { ...fields, role: 'PENDING' });
  }

  // 옛 applyProfileUpdates(null은 건너뜀)다. 검사를 거친 값은 null이 아니라서 네 칸을 모두 덮어쓰는 것과 같다.
  updateProfile(
    githubId: string,
    fields: ProfileFields,
  ): Promise<ProfileWriteResult> {
    return this.writeProfile(githubId, fields);
  }

  // 응답의 updatedAt은 **수정 전 값**이다 [추정]. 옛 서비스는 엔티티를 고친 뒤 flush(DB에 쓰기)가 일어나기 전에 응답을 만들었고,
  // updated_at은 flush 때 JPA 감사 기능이 채우므로 응답을 만들 때는 아직 옛 값이었을 것이다. 이메일·학번 등 나머지 칸은 새 값이다.
  // DB에는 새 updated_at이 들어간다.
  private writeProfile(
    githubId: string,
    data: ProfileFields & { role?: 'PENDING' },
  ): Promise<ProfileWriteResult> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({
        where: { githubId },
        select: { updatedAt: true },
      });
      if (!before) return { status: 'USER_NOT_FOUND' };
      const row = await tx.user.update({
        where: { githubId },
        data: { ...data, updatedAt: kstWallClockNow() },
        select: PROFILE_SELECT,
      });
      return {
        status: 'UPDATED',
        profile: { ...toUserProfile(row), updatedAt: before.updatedAt },
      };
    });
  }

  // 옛 approveUserProfile: 없으면 404, PENDING이 아니면 거부, 맞으면 USER로 바꾼다.
  async approve(userId: bigint): Promise<ApproveResult> {
    const user = await this.prisma.user.findUnique({
      where: { userId },
      select: { role: true },
    });
    if (!user) return { status: 'USER_NOT_FOUND' };
    if (user.role !== 'PENDING') return { status: 'NOT_PENDING' };
    await this.prisma.user.update({
      where: { userId },
      data: { role: 'USER', updatedAt: kstWallClockNow() },
    });
    return { status: 'APPROVED' };
  }
}
