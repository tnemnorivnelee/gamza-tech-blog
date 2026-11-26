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
    completeProfile: vi.fn().mockResolvedValue(PROFILE),
    updateProfile: vi.fn().mockResolvedValue(PROFILE),
    approveUserProfile: vi.fn().mockResolvedValue(undefined),
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
  const send = async (
    method: 'POST' | 'PUT',
    path: string,
    headers: Record<string, string> = {},
    body?: unknown,
  ) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers:
        body === undefined
          ? headers
          : { ...headers, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const bearer = (githubId: string) => ({
    authorization: `Bearer ${moduleRef.get(JwtTokenService).createAccessToken(githubId)}`,
  });
  return { app, service, get, send, bearer };
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

// 쓰기 API: 서비스는 가짜다. 요청 검사(옛 @Valid), 읽을 수 없는 값(500), 접근 규칙, 메시지, 경로의 번호를 본다.
// 저장·캐시 규칙은 user.service.spec.ts와 user-write.repository.spec.ts가 본다.
describe('사용자 쓰기 API', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createApp();
  });

  afterAll(() => t.app.close());

  beforeEach(() => vi.clearAllMocks());

  const complete = '/api/v1/users/me/complete';
  const update = '/api/v1/users/me/update/profile';
  const VALID = {
    email: 'jihun@example.com',
    studentNumber: '20231234',
    gamjaBatch: 9,
    position: 'BACKEND',
  };

  describe('POST /api/v1/users/me/complete', () => {
    it('토큰이 없으면 403 J004다', async () => {
      const res = await t.send('POST', complete, {}, VALID);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J004' });
      expect(t.service.completeProfile).not.toHaveBeenCalled();
    });

    // 옛 hasRole('PRE_REGISTER'): 가입을 끝낸 사용자와 승인 대기 사용자, 관리자도 거부한다.
    it.each(['octo', 'waiting', 'boss'])('%s는 403 J005다', async (who) => {
      const res = await t.send('POST', complete, t.bearer(who), VALID);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J005' });
      expect(t.service.completeProfile).not.toHaveBeenCalled();
    });

    it('PRE_REGISTER는 HTTP 200에 옛 메시지와 프로필을 받는다', async () => {
      const res = await t.send('POST', complete, t.bearer('newbie'), VALID);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 200,
        message: '프로필이 성공적으로 완성되었습니다.',
        data: PROFILE,
        timestamp: expect.any(Number),
      });
      expect(t.service.completeProfile).toHaveBeenCalledWith('newbie', VALID);
    });

    it('이메일은 없어도 되고, 없으면 null로 넘어간다', async () => {
      const { email: _email, ...withoutEmail } = VALID;
      const res = await t.send(
        'POST',
        complete,
        t.bearer('newbie'),
        withoutEmail,
      );
      expect(res.status).toBe(200);
      expect(t.service.completeProfile).toHaveBeenCalledWith('newbie', {
        ...withoutEmail,
        email: null,
      });
    });

    it('학번이 겹친다는 서비스의 409 U004가 그대로 나간다', async () => {
      t.service.completeProfile.mockRejectedValueOnce(
        new BusinessException(ErrorCode.EMAIL_ALREADY_EXISTS),
      );
      const res = await t.send('POST', complete, t.bearer('newbie'), VALID);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'U004' });
    });

    // 옛 @Valid: 서비스에 가기 전에 400 C001과 필드별 오류(필드, 거부된 값, 규칙의 메시지)다.
    it('값이 틀리면 400 C001과 필드 오류이고 서비스를 부르지 않는다', async () => {
      const res = await t.send('POST', complete, t.bearer('newbie'), {
        email: 'not-an-email',
        studentNumber: '  ',
        position: 'BACKEND',
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ status: 400, code: 'C001' });
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          {
            field: 'email',
            value: 'not-an-email',
            reason: '올바른 형식의 이메일 주소여야 합니다',
          },
          { field: 'studentNumber', value: '  ', reason: '공백일 수 없습니다' },
          { field: 'gamjaBatch', value: '', reason: '널이어서는 안됩니다' },
        ]),
      );
      expect(res.body.errors).toHaveLength(3);
      expect(t.service.completeProfile).not.toHaveBeenCalled();
    });

    it('포지션이 enum 밖이면 읽을 수 없어서 500 C004다(옛 Jackson 읽기 실패)', async () => {
      const res = await t.send('POST', complete, t.bearer('newbie'), {
        ...VALID,
        position: 'SENIOR',
      });
      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ code: 'C004' });
      expect(t.service.completeProfile).not.toHaveBeenCalled();
    });

    // 알려진 차이: 옛 @PreAuthorize는 인자를 읽고 검사한 뒤에 돌아서, 권한이 없고 본문도 틀린 요청은 400이 먼저였다.
    // 여기서는 가드가 먼저라서 403이다.
    it('권한이 없고 본문도 틀리면 403이 먼저다', async () => {
      const res = await t.send('POST', complete, t.bearer('octo'), {});
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J005' });
    });
  });

  describe('PUT /api/v1/users/me/update/profile', () => {
    it('토큰이 없으면 403 J004다', async () => {
      const res = await t.send('PUT', update, {}, VALID);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J004' });
    });

    it.each(['waiting', 'newbie'])('%s는 403 J005다', async (who) => {
      const res = await t.send('PUT', update, t.bearer(who), VALID);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J005' });
      expect(t.service.updateProfile).not.toHaveBeenCalled();
    });

    it.each(['octo', 'boss'])(
      '%s(USER, ADMIN)는 HTTP 200에 옛 메시지와 프로필을 받는다',
      async (who) => {
        const res = await t.send('PUT', update, t.bearer(who), VALID);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          status: 200,
          message: '프로필이 수정되었습니다',
          data: PROFILE,
          timestamp: expect.any(Number),
        });
        expect(t.service.updateProfile).toHaveBeenCalledWith(who, VALID);
      },
    );

    it('수정에서는 이메일이 필수다(없으면 400 C001)', async () => {
      const { email: _email, ...withoutEmail } = VALID;
      const res = await t.send('PUT', update, t.bearer('octo'), withoutEmail);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'C001' });
      expect(res.body.errors).toEqual([
        { field: 'email', value: '', reason: '공백일 수 없습니다' },
      ]);
      expect(t.service.updateProfile).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/admin/users/:id/approve', () => {
    const approve = (id: string | number) => `/api/admin/users/${id}/approve`;

    it('토큰이 없으면 403 J004다', async () => {
      const res = await t.send('PUT', approve(7));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J004' });
    });

    it.each(['octo', 'waiting', 'newbie'])('%s는 403 J005다', async (who) => {
      const res = await t.send('PUT', approve(7), t.bearer(who));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J005' });
      expect(t.service.approveUserProfile).not.toHaveBeenCalled();
    });

    it('ADMIN은 HTTP 200에 옛 메시지를 받고 data 키는 없다', async () => {
      const res = await t.send('PUT', approve(7), t.bearer('boss'));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 200,
        message: '사용자 승인 완료',
        timestamp: expect.any(Number),
      });
      expect(t.service.approveUserProfile).toHaveBeenCalledWith(7n);
    });

    it('서비스의 404 U001과 400 C001이 그대로 나간다', async () => {
      t.service.approveUserProfile.mockRejectedValueOnce(
        new BusinessException(ErrorCode.USER_NOT_FOUND),
      );
      const missing = await t.send('PUT', approve(7), t.bearer('boss'));
      expect(missing).toMatchObject({ status: 404, body: { code: 'U001' } });

      t.service.approveUserProfile.mockRejectedValueOnce(
        new BusinessException(ErrorCode.INVALID_INPUT_VALUE),
      );
      const notPending = await t.send('PUT', approve(7), t.bearer('boss'));
      expect(notPending).toMatchObject({ status: 400, body: { code: 'C001' } });
    });

    it.each(['abc', '1.5', '99999999999999999999'])(
      '사용자 번호가 숫자가 아니거나 Long을 넘으면(%s) 400 C005다',
      async (raw) => {
        const res = await t.send('PUT', approve(raw), t.bearer('boss'));
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({
          code: 'C005',
          errors: [{ field: 'id', value: raw, reason: 'typeMismatch' }],
        });
        expect(t.service.approveUserProfile).not.toHaveBeenCalled();
      },
    );

    // 옛 @Positive가 0 이하를 거부하는데, 그 예외를 다루는 처리기가 없어서 500 C004였다고 본다 [추정].
    it.each(['0', '-3'])(
      '사용자 번호가 0 이하이면(%s) 500 C004다 [추정]',
      async (raw) => {
        const res = await t.send('PUT', approve(raw), t.bearer('boss'));
        expect(res.status).toBe(500);
        expect(res.body).toMatchObject({ code: 'C004' });
        expect(t.service.approveUserProfile).not.toHaveBeenCalled();
      },
    );
  });
});
