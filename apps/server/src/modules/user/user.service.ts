import { Injectable } from '@nestjs/common';
import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import { toLocalDateTimeSeconds } from '../../common/local-date-time.js';
import type { PageRequest } from '../../common/pageable.js';
import { ReadCache } from '../../common/read-cache.js';
import { PostService } from '../post/post.service.js';
import type { PendingUserResponse } from './dto/pending-user-response.dto.js';
import type { UserActivityResponse } from './dto/user-activity-response.dto.js';
import type { UserProfileResponse } from './dto/user-profile-response.dto.js';
import type { UserPublicProfileResponse } from './dto/user-public-profile-response.dto.js';
import type { ProfileFields } from './dto/profile-request.js';
import {
  type UserProfile,
  UserQueryRepository,
} from './user-query.repository.js';
import { UserWriteRepository } from './user-write.repository.js';

const toProfileResponse = (profile: UserProfile): UserProfileResponse => ({
  ...profile,
  createdAt: toLocalDateTimeSeconds(profile.createdAt),
  updatedAt: toLocalDateTimeSeconds(profile.updatedAt),
});

// @Injectable: Nest가 만들어 다른 클래스의 생성자에 넣어 주는 부품이라는 표시다(프론트의 서비스 클래스와 비슷하다).
// 공개 프로필의 글 목록은 글 모듈의 PostService가 만든다(옛 UserServiceImpl이 글 모듈의 조회 포트 postQueryPort를 쓴 것과 같다).
// 옛 @Cacheable은 getCurrentUserProfile(userProfile)과 getPublicProfileByNickname(publicProfileAggregate)에 있었다.
// 쓰기에서 캐시를 지우는 것은 updateProfile(userProfile) 하나뿐이다. completeProfile과 approveUserProfile은 옛 코드도 지우지 않아서,
// 완성·승인 직전에 읽은 내 프로필은 최대 5분 동안 옛 role로 나간다(me/role은 DB를 읽어 바로 바뀐다).
@Injectable()
export class UserService {
  constructor(
    private readonly users: UserQueryRepository,
    private readonly writes: UserWriteRepository,
    private readonly posts: PostService,
    private readonly cache: ReadCache,
  ) {}

  // 키는 옛 코드처럼 githubId다. 옛 코드는 예외(404)를 저장하지 않았고 여기도 같다.
  getCurrentUserProfile(githubId: string): Promise<UserProfileResponse> {
    return this.cache.cached('userProfile', githubId, () =>
      this.loadCurrentUserProfile(githubId),
    );
  }

  getActivitySummary(githubId: string): Promise<UserActivityResponse> {
    return this.users.countActivity(githubId);
  }

  // 키는 옛 코드처럼 "닉네임-쪽 번호-쪽 크기"다. 닉네임의 대소문자를 합치지 않는다(DB는 합쳐서 찾지만 키는 요청 그대로다).
  getPublicProfileByNickname(nickname: string, page: PageRequest) {
    return this.cache.cached(
      'publicProfileAggregate',
      `${nickname}-${page.page}-${page.size}`,
      () => this.loadPublicProfile(nickname, page),
    );
  }

  getPendingUsers(): Promise<PendingUserResponse[]> {
    return this.users.findPendingUsers();
  }

  // 학번이 이미 있으면 409 U004다. 옛 validateDuplicateStudentNumber가 학번 중복에 이메일 중복 코드(EMAIL_ALREADY_EXISTS)를 썼다.
  // 이 검사는 사용자를 찾기 전이다. 캐시는 지우지 않는다(위 설명).
  async completeProfile(
    githubId: string,
    fields: ProfileFields,
  ): Promise<UserProfileResponse> {
    if (await this.writes.existsByStudentNumber(fields.studentNumber))
      throw new BusinessException(ErrorCode.EMAIL_ALREADY_EXISTS);
    const result = await this.writes.completeProfile(githubId, fields);
    if (result.status === 'USER_NOT_FOUND')
      throw new BusinessException(ErrorCode.USER_NOT_FOUND);
    return toProfileResponse(result.profile);
  }

  // 옛 @CacheEvict(userProfile, key = githubId)는 메서드가 성공한 뒤에 지운다(실패하면 캐시는 그대로다).
  async updateProfile(
    githubId: string,
    fields: ProfileFields,
  ): Promise<UserProfileResponse> {
    const result = await this.writes.updateProfile(githubId, fields);
    if (result.status === 'USER_NOT_FOUND')
      throw new BusinessException(ErrorCode.USER_NOT_FOUND);
    await this.cache.evict('userProfile', githubId);
    return toProfileResponse(result.profile);
  }

  // 없으면 404 U001, PENDING이 아니면 400 C001이다(옛 UserNotPendingException은 INVALID_INPUT_VALUE였다).
  // 옛 예외의 사용자 지정 메시지("N번 사용자를 찾을 수 없습니다.", "사용자가 승인 대기 상태가 아닙니다.")는 응답에 나가지 않았다:
  // 옛 처리기가 ErrorCode의 기본 메시지만 응답에 담았다. 캐시는 지우지 않는다.
  async approveUserProfile(userId: bigint): Promise<void> {
    const result = await this.writes.approve(userId);
    if (result.status === 'USER_NOT_FOUND')
      throw new BusinessException(ErrorCode.USER_NOT_FOUND);
    if (result.status === 'NOT_PENDING')
      throw new BusinessException(ErrorCode.INVALID_INPUT_VALUE);
  }

  // 옛 코드는 토큰의 사용자를 DB에서 다시 읽는다. 그 사이 사라졌다면 404 U001이다.
  private async loadCurrentUserProfile(
    githubId: string,
  ): Promise<UserProfileResponse> {
    const profile = await this.users.findProfileByGithubId(githubId);
    if (!profile) throw new BusinessException(ErrorCode.USER_NOT_FOUND);
    return toProfileResponse(profile);
  }

  // 닉네임이 없으면 404 U001이다. 글 목록은 getMyPosts와 같은 조회다(createdAt 내림차순 고정, 요청의 sort는 무시).
  // 글 목록은 캐시가 붙은 getMyPosts가 아니라 캐시 없는 findPostsByWriter로 읽는다. 옛 코드가 postQueryPort를 직접 불렀다.
  private async loadPublicProfile(
    nickname: string,
    page: PageRequest,
  ): Promise<UserPublicProfileResponse> {
    const target = await this.users.findPublicProfileByNickname(nickname);
    if (!target) throw new BusinessException(ErrorCode.USER_NOT_FOUND);
    // 옛 코드는 활동 개수와 글 목록을 차례로 읽었다. 서로 기다릴 이유가 없어서 함께 보낸다.
    const [activity, posts] = await Promise.all([
      this.users.countActivity(target.githubId),
      this.posts.findPostsByWriter(target.githubId, page),
    ]);
    return {
      profile: {
        profileImageUrl: target.profileImageUrl,
        nickname: target.nickname,
        gamjaBatch: target.gamjaBatch,
      },
      activity,
      posts,
    };
  }
}
