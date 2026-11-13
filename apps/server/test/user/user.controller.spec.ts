import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CommonModule } from '../../src/common/common.module.js';
import { PagedResponse } from '../../src/common/dto/paged-response.dto.js';
import { BusinessException } from '../../src/common/error/business.exception.js';
import { ErrorCode } from '../../src/common/error/error-code.js';
import { validateEnv } from '../../src/config/env.validation.js';
import { AuthModule } from '../../src/modules/auth/auth.module.js';
import { InMemoryTokenStore } from '../../src/modules/auth/in-memory-token-store.js';
import { JwtTokenService } from '../../src/modules/auth/jwt-token.service.js';
import { TokenStore } from '../../src/modules/auth/token-store.js';
import type { PostListResponse } from '../../src/modules/post/dto/post-list-response.dto.js';
import { AdminUserController } from '../../src/modules/user/admin-user.controller.js';
import type { PendingUserResponse } from '../../src/modules/user/dto/pending-user-response.dto.js';
import type { UserActivityResponse } from '../../src/modules/user/dto/user-activity-response.dto.js';
import type { UserProfileResponse } from '../../src/modules/user/dto/user-profile-response.dto.js';
import type { UserPublicProfileResponse } from '../../src/modules/user/dto/user-public-profile-response.dto.js';
import { UserController } from '../../src/modules/user/user.controller.js';
import {
  type User,
  UserRepository,
} from '../../src/modules/user/user.repository.js';
import { UserService } from '../../src/modules/user/user.service.js';

const USERS = new Map<string, User>([
  ['octo', { githubId: 'octo', role: 'USER', email: null }],
  ['boss', { githubId: 'boss', role: 'ADMIN', email: null }],
  ['waiting', { githubId: 'waiting', role: 'PENDING', email: null }],
  ['newbie', { githubId: 'newbie', role: 'PRE_REGISTER', email: null }],
]);

const PROFILE: UserProfileResponse = {
  githubId: 'octo',
  nickname: '감자',
  name: '박지훈',
  email: null,
  profileImageUrl: null,
  position: 'BACKEND',
  role: 'USER',
  studentNumber: null,
  gamjaBatch: 9,
  createdAt: '2025-07-27T21:08:37',
  updatedAt: '2025-08-05T10:20:30',
};
const ACTIVITY: UserActivityResponse = {
  likedPostCount: 5,
  writtenPostCount: 10,
  writtenCommentCount: 20,
};
const PUBLIC_PROFILE: UserPublicProfileResponse = {
  profile: { profileImageUrl: null, nickname: '감자', gamjaBatch: 9 },
  activity: ACTIVITY,
  posts: new PagedResponse<PostListResponse>([], 0, 20, 0, 0),
};
const PENDING: PendingUserResponse[] = [
  { userId: 12, gamjaBatch: 9, name: '박지훈', position: 'BACKEND' },
];

// 서비스는 가짜다. 이 시험은 요청 해석(경로의 닉네임, page, size), 메시지, 오류 코드, 접근 규칙을 본다.
// 쿼리의 의미는 user-query.repository.spec.ts가 진짜 MySQL로 증명한다. 사용자·토큰 저장소도 가짜라서 DB와 Redis가 필요 없다.
async function createApp() {
  const service = {
    getCurrentUserProfile: vi.fn().mockResolvedValue(PROFILE),
    getActivitySummary: vi.fn().mockResolvedValue(ACTIVITY),
    getPublicProfileByNickname: vi.fn().mockResolvedValue(PUBLIC_PROFILE),
    getPendingUsers: vi.fn().mockResolvedValue(PENDING),
  };
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        validate: validateEnv,
      }),
      CommonModule,
      AuthModule,
    ],
    controllers: [UserController, AdminUserController],
    providers: [{ provide: UserService, useValue: service }],
  })
    .overrideProvider(UserRepository)
    .useValue({
      findByGithubId: (githubId: string) =>
        Promise.resolve(USERS.get(githubId)),
    })
    .overrideProvider(TokenStore)
    .useClass(InMemoryTokenStore)
    .compile();
  const app = moduleRef.createNestApplication();
  await app.listen(0);
  const baseUrl = await app.getUrl();

  const get = async (path: string, headers: Record<string, string> = {}) => {
    const res = await fetch(`${baseUrl}${path}`, { headers });
    return { status: res.status, body: await res.json() };
  };
  const bearer = (githubId: string) => ({
    authorization: `Bearer ${moduleRef.get(JwtTokenService).createAccessToken(githubId)}`,
  });
  return { app, service, get, bearer };
}

type TestApp = Awaited<ReturnType<typeof createApp>>;

describe('사용자 읽기 API', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createApp();
  });

  afterAll(() => t.app.close());

  beforeEach(() => vi.clearAllMocks());

  describe('GET /api/v1/users/me/get/profile', () => {
    it('토큰이 없으면 403 J004다', async () => {
      const res = await t.get('/api/v1/users/me/get/profile');
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J004' });
      expect(t.service.getCurrentUserProfile).not.toHaveBeenCalled();
    });

    it('로그인한 사용자의 githubId로 조회하고 HTTP 200에 옛 메시지를 준다', async () => {
      const res = await t.get('/api/v1/users/me/get/profile', t.bearer('octo'));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 200,
        message: '프로필 조회 성공',
        data: PROFILE,
        timestamp: expect.any(Number),
      });
      expect(t.service.getCurrentUserProfile).toHaveBeenCalledWith('octo');
    });

    it('값이 없는 칸은 키가 빠지지 않고 null로 나간다', async () => {
      const res = await t.get('/api/v1/users/me/get/profile', t.bearer('octo'));
      expect(res.body.data).toMatchObject({
        email: null,
        profileImageUrl: null,
        studentNumber: null,
      });
    });

    it('ADMIN도 부를 수 있다', async () => {
      const res = await t.get('/api/v1/users/me/get/profile', t.bearer('boss'));
      expect(res.status).toBe(200);
    });

    // 기본 규칙은 USER, ADMIN이다. 가입을 끝내지 않은 사용자는 이 경로를 못 부르고 role 경로만 부른다.
    it.each(['waiting', 'newbie'])(
      '%s(PENDING·PRE_REGISTER)는 거부한다',
      async (id) => {
        const res = await t.get('/api/v1/users/me/get/profile', t.bearer(id));
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ data: 'J005' });
      },
    );

    it('없는 사용자면 서비스가 던진 404 U001이 그대로 나간다', async () => {
      t.service.getCurrentUserProfile.mockRejectedValueOnce(
        new BusinessException(ErrorCode.USER_NOT_FOUND),
      );
      const res = await t.get('/api/v1/users/me/get/profile', t.bearer('octo'));
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ status: 404, code: 'U001' });
    });
  });

  describe('GET /api/v1/users/me/activity', () => {
    it('토큰이 없으면 403 J004다', async () => {
      const res = await t.get('/api/v1/users/me/activity');
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J004' });
    });

    it('로그인한 사용자의 githubId로 센 개수와 옛 메시지를 준다', async () => {
      const res = await t.get('/api/v1/users/me/activity', t.bearer('octo'));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        message: '유저 활동 정보 조회 성공',
        data: ACTIVITY,
      });
      expect(t.service.getActivitySummary).toHaveBeenCalledWith('octo');
    });

    it('승인 대기 사용자는 거부한다', async () => {
      const res = await t.get('/api/v1/users/me/activity', t.bearer('waiting'));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J005' });
    });
  });

  describe('GET /api/v1/users/me/role', () => {
    it('토큰이 없으면 403 J004다', async () => {
      const res = await t.get('/api/v1/users/me/role');
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J004' });
    });

    // 가입 화면과 승인 대기 화면이 role을 보고 어느 화면을 보여 줄지 정한다.
    it.each([
      ['octo', 'USER'],
      ['boss', 'ADMIN'],
      ['waiting', 'PENDING'],
      ['newbie', 'PRE_REGISTER'],
    ])(
      '%s는 부를 수 있고 role 이름을 문자열로 받는다(%s)',
      async (id, role) => {
        const res = await t.get('/api/v1/users/me/role', t.bearer(id));
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          message: '역할 조회 성공',
          data: role,
        });
      },
    );
  });

  describe('GET /api/v1/users/public/profile/:nickname', () => {
    it('토큰 없이도 부를 수 있고, HTTP 200에 옛 메시지를 준다', async () => {
      const res = await t.get('/api/v1/users/public/profile/octo');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 200,
        message: '공개 프로필 조회 성공',
        data: PUBLIC_PROFILE,
        timestamp: expect.any(Number),
      });
    });

    // 다른 목록은 10이지만 이 경로만 @PageableDefault가 없어서 Spring 기본값 20이다.
    it('아무것도 없으면 0쪽, 크기 20이다', async () => {
      await t.get('/api/v1/users/public/profile/octo');
      expect(t.service.getPublicProfileByNickname).toHaveBeenCalledWith(
        'octo',
        {
          page: 0,
          size: 20,
        },
      );
    });

    it('page와 size를 읽고, sort는 무시한다', async () => {
      await t.get(
        '/api/v1/users/public/profile/octo?page=2&size=5&sort=id,asc',
      );
      expect(t.service.getPublicProfileByNickname).toHaveBeenCalledWith(
        'octo',
        {
          page: 2,
          size: 5,
        },
      );
    });

    it('한글 닉네임을 URL 인코딩해서 보내도 받는다', async () => {
      await t.get(`/api/v1/users/public/profile/${encodeURIComponent('감자')}`);
      expect(t.service.getPublicProfileByNickname.mock.calls[0][0]).toBe(
        '감자',
      );
    });

    it('없는 닉네임이면 서비스가 던진 404 U001이 그대로 나간다', async () => {
      t.service.getPublicProfileByNickname.mockRejectedValueOnce(
        new BusinessException(ErrorCode.USER_NOT_FOUND),
      );
      const res = await t.get('/api/v1/users/public/profile/nobody');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ status: 404, code: 'U001' });
    });
  });

  describe('GET /api/admin/users/pending', () => {
    it('토큰이 없으면 403 J004다', async () => {
      const res = await t.get('/api/admin/users/pending');
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J004' });
    });

    it('ADMIN이 아니면 거부한다', async () => {
      const res = await t.get('/api/admin/users/pending', t.bearer('octo'));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J005' });
      expect(t.service.getPendingUsers).not.toHaveBeenCalled();
    });

    it('ADMIN은 목록과 옛 메시지를 받는다', async () => {
      const res = await t.get('/api/admin/users/pending', t.bearer('boss'));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        message: '대기 중인 사용자 조회 성공',
        data: PENDING,
      });
    });

    it('대기 중인 사용자가 없으면 빈 목록이다(data가 빠지지 않는다)', async () => {
      t.service.getPendingUsers.mockResolvedValueOnce([]);
      const res = await t.get('/api/admin/users/pending', t.bearer('boss'));
      expect(res.body.data).toEqual([]);
    });
  });
});
