import { ErrorCode } from '../../common/error/error-code.js';
import { createReadCache } from '../../../test/support/fake-redis.js';
import type { PostService } from '../post/post.service.js';
import type {
  PublicProfile,
  UserProfile,
  UserQueryRepository,
} from './user-query.repository.js';
import { UserService } from './user.service.js';

const profile = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  githubId: 'octo',
  nickname: '감자',
  name: '박지훈',
  email: 'octo@example.com',
  profileImageUrl: 'https://img.test/p.png',
  position: 'BACKEND',
  role: 'USER',
  studentNumber: '20231234',
  gamjaBatch: 9,
  createdAt: new Date('2025-07-27T21:08:37.999Z'),
  updatedAt: new Date('2025-08-05T10:20:30.123Z'),
  ...overrides,
});

const target: PublicProfile = {
  githubId: 'octo',
  nickname: '감자',
  gamjaBatch: 9,
  profileImageUrl: null,
};
const ACTIVITY = {
  likedPostCount: 5,
  writtenPostCount: 10,
  writtenCommentCount: 20,
};
const POSTS = {
  content: [],
  page: 0,
  size: 20,
  totalElements: 0,
  totalPages: 0,
};

function setup() {
  const repo = {
    findProfileByGithubId: vi.fn().mockResolvedValue(profile()),
    findPublicProfileByNickname: vi.fn().mockResolvedValue(target),
    countActivity: vi.fn().mockResolvedValue(ACTIVITY),
    findPendingUsers: vi.fn().mockResolvedValue([]),
  };
  // 공개 프로필은 캐시가 붙은 getMyPosts가 아니라 캐시 없는 findPostsByWriter로 글 목록을 읽는다(옛 postQueryPort 직접 호출).
  const posts = {
    findPostsByWriter: vi.fn().mockResolvedValue(POSTS),
    getMyPosts: vi.fn().mockResolvedValue(POSTS),
  };
  // 캐시는 가짜 Redis 위의 진짜 ReadCache다. 시험마다 새로 만들어서 앞 시험의 캐시가 남지 않는다.
  const { redis, cache } = createReadCache();
  return {
    repo,
    posts,
    redis,
    service: new UserService(
      repo as unknown as UserQueryRepository,
      posts as unknown as PostService,
      cache,
    ),
  };
}

describe('UserService', () => {
  describe('getCurrentUserProfile', () => {
    it('날짜는 초까지만 쓴 문자열이고 나머지는 그대로다', async () => {
      const { service, repo } = setup();
      expect(await service.getCurrentUserProfile('octo')).toEqual({
        githubId: 'octo',
        nickname: '감자',
        name: '박지훈',
        email: 'octo@example.com',
        profileImageUrl: 'https://img.test/p.png',
        position: 'BACKEND',
        role: 'USER',
        studentNumber: '20231234',
        gamjaBatch: 9,
        createdAt: '2025-07-27T21:08:37',
        updatedAt: '2025-08-05T10:20:30',
      });
      expect(repo.findProfileByGithubId).toHaveBeenCalledWith('octo');
    });

    it('값이 없는 칸은 키가 빠지지 않고 null이다(가입 전 사용자)', async () => {
      const { service, repo } = setup();
      repo.findProfileByGithubId.mockResolvedValue(
        profile({
          email: null,
          profileImageUrl: null,
          position: null,
          studentNumber: null,
          gamjaBatch: null,
          role: 'PRE_REGISTER',
        }),
      );
      const response = await service.getCurrentUserProfile('octo');
      expect(response).toMatchObject({
        email: null,
        profileImageUrl: null,
        position: null,
        studentNumber: null,
        gamjaBatch: null,
        role: 'PRE_REGISTER',
      });
      expect(Object.keys(response)).toHaveLength(11);
    });

    it('사용자가 없으면 404 U001이다', async () => {
      const { service, repo } = setup();
      repo.findProfileByGithubId.mockResolvedValue(null);
      await expect(
        service.getCurrentUserProfile('ghost'),
      ).rejects.toMatchObject({ errorCode: ErrorCode.USER_NOT_FOUND });
    });
  });

  it('getActivitySummary는 저장소의 세 개수를 그대로 준다', async () => {
    const { service, repo } = setup();
    expect(await service.getActivitySummary('octo')).toEqual(ACTIVITY);
    expect(repo.countActivity).toHaveBeenCalledWith('octo');
  });

  describe('getPublicProfileByNickname', () => {
    it('프로필, 활동, 그 사용자의 글 목록을 묶는다(githubId는 싣지 않는다)', async () => {
      const { service, repo, posts } = setup();
      const page = { page: 1, size: 20 };
      expect(await service.getPublicProfileByNickname('감자', page)).toEqual({
        profile: { profileImageUrl: null, nickname: '감자', gamjaBatch: 9 },
        activity: ACTIVITY,
        posts: POSTS,
      });
      expect(repo.findPublicProfileByNickname).toHaveBeenCalledWith('감자');
      expect(repo.countActivity).toHaveBeenCalledWith('octo');
      expect(posts.findPostsByWriter).toHaveBeenCalledWith('octo', page);
      expect(posts.getMyPosts).not.toHaveBeenCalled();
    });

    it('응답의 닉네임은 요청 값이 아니라 저장된 값이다', async () => {
      const { service } = setup();
      const response = await service.getPublicProfileByNickname('OCTO', {
        page: 0,
        size: 20,
      });
      expect(response.profile.nickname).toBe('감자');
    });

    it('닉네임이 없으면 404 U001이고 활동과 글은 읽지 않는다', async () => {
      const { service, repo, posts } = setup();
      repo.findPublicProfileByNickname.mockResolvedValue(null);
      await expect(
        service.getPublicProfileByNickname('없음', { page: 0, size: 20 }),
      ).rejects.toMatchObject({ errorCode: ErrorCode.USER_NOT_FOUND });
      expect(repo.countActivity).not.toHaveBeenCalled();
      expect(posts.findPostsByWriter).not.toHaveBeenCalled();
    });
  });

  it('getPendingUsers는 저장소의 목록을 그대로 준다', async () => {
    const { service, repo } = setup();
    const pending = [
      { userId: 3, gamjaBatch: null, name: '이름', position: null },
    ];
    repo.findPendingUsers.mockResolvedValue(pending);
    expect(await service.getPendingUsers()).toEqual(pending);
  });

  // 옛 @Cacheable: userProfile(키 githubId), publicProfileAggregate(키 "닉네임-쪽 번호-쪽 크기"). 둘 다 만료는 5분이다.
  describe('읽기 캐시', () => {
    describe('getCurrentUserProfile', () => {
      it('userProfile 이름에 githubId 키로 5분 동안 저장하고, 다시 부르면 저장소를 부르지 않고 같은 값을 준다', async () => {
        const { service, repo, redis } = setup();
        const miss = await service.getCurrentUserProfile('octo');
        expect(redis.ttls.get('cache:userProfile:octo')).toBe(300);
        expect(await service.getCurrentUserProfile('octo')).toEqual(miss);
        expect(repo.findProfileByGithubId).toHaveBeenCalledTimes(1);
      });

      it('사용자마다 따로 저장한다', async () => {
        const { service, redis } = setup();
        await service.getCurrentUserProfile('octo');
        await service.getCurrentUserProfile('boss');
        expect([...redis.values.keys()].sort()).toEqual([
          'cache:userProfile:boss',
          'cache:userProfile:octo',
        ]);
      });

      it('없는 사용자의 404는 저장하지 않는다', async () => {
        const { service, repo, redis } = setup();
        repo.findProfileByGithubId.mockResolvedValue(null);
        await expect(service.getCurrentUserProfile('ghost')).rejects.toThrow();
        await expect(service.getCurrentUserProfile('ghost')).rejects.toThrow();
        expect(redis.values.size).toBe(0);
        expect(repo.findProfileByGithubId).toHaveBeenCalledTimes(2);
      });
    });

    describe('getPublicProfileByNickname', () => {
      const page = { page: 1, size: 20 };

      it('publicProfileAggregate 이름에 "닉네임-쪽-크기" 키로 5분 동안 저장하고, 다시 부르면 아무것도 읽지 않고 같은 값을 준다', async () => {
        const { service, repo, posts, redis } = setup();
        const miss = await service.getPublicProfileByNickname('감자', page);
        expect(redis.ttls.get('cache:publicProfileAggregate:감자-1-20')).toBe(
          300,
        );
        expect(await service.getPublicProfileByNickname('감자', page)).toEqual(
          miss,
        );
        expect(repo.findPublicProfileByNickname).toHaveBeenCalledTimes(1);
        expect(repo.countActivity).toHaveBeenCalledTimes(1);
        expect(posts.findPostsByWriter).toHaveBeenCalledTimes(1);
      });

      // 옛 키는 요청의 닉네임 그대로다. DB는 대소문자를 합쳐 찾지만 캐시는 따로 저장한다.
      it('닉네임의 대소문자를 합치지 않고 따로 저장한다', async () => {
        const { service, redis } = setup();
        await service.getPublicProfileByNickname('Cafe', page);
        await service.getPublicProfileByNickname('CAFE', page);
        expect([...redis.values.keys()].sort()).toEqual([
          'cache:publicProfileAggregate:CAFE-1-20',
          'cache:publicProfileAggregate:Cafe-1-20',
        ]);
      });

      it('쪽 번호나 크기가 다르면 따로 저장한다', async () => {
        const { service, redis } = setup();
        await service.getPublicProfileByNickname('감자', page);
        await service.getPublicProfileByNickname('감자', { page: 0, size: 20 });
        await service.getPublicProfileByNickname('감자', { page: 1, size: 10 });
        expect(redis.values.size).toBe(3);
      });

      // 옛 코드는 글 목록을 캐시가 붙은 getMyPosts가 아니라 postQueryPort로 직접 읽었다. 그래서 myPosts 캐시가 생기지 않는다.
      it('안쪽의 글 목록 조회는 캐시를 거치지 않아서 myPosts는 저장되지 않는다', async () => {
        const { service, redis } = setup();
        await service.getPublicProfileByNickname('감자', page);
        expect([...redis.values.keys()]).toEqual([
          'cache:publicProfileAggregate:감자-1-20',
        ]);
      });

      it('없는 닉네임의 404는 저장하지 않는다', async () => {
        const { service, repo, redis } = setup();
        repo.findPublicProfileByNickname.mockResolvedValue(null);
        await expect(
          service.getPublicProfileByNickname('없음', page),
        ).rejects.toThrow();
        expect(redis.values.size).toBe(0);
      });
    });

    it('getActivitySummary와 getPendingUsers는 캐시가 없다', async () => {
      const { service, repo, redis } = setup();
      await service.getActivitySummary('octo');
      await service.getActivitySummary('octo');
      await service.getPendingUsers();
      await service.getPendingUsers();
      expect(redis.values.size).toBe(0);
      expect(repo.countActivity).toHaveBeenCalledTimes(2);
      expect(repo.findPendingUsers).toHaveBeenCalledTimes(2);
    });
  });
});
