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
import type { LikeResponse } from '../../src/modules/like/dto/like-response.dto.js';
import { LikeController } from '../../src/modules/like/like.controller.js';
import { LikeService } from '../../src/modules/like/like.service.js';
import {
  type User,
  UserRepository,
} from '../../src/modules/user/user.repository.js';

const USERS = new Map<string, User>([
  ['octo', { githubId: 'octo', role: 'USER', email: null }],
  ['boss', { githubId: 'boss', role: 'ADMIN', email: null }],
  ['waiting', { githubId: 'waiting', role: 'PENDING', email: null }],
  ['newbie', { githubId: 'newbie', role: 'PRE_REGISTER', email: null }],
]);

// 태그가 없는 글은 [null]이고, 값이 없는 이미지 주소는 null이다(옛 동작).
const LIKE: LikeResponse = {
  likeId: 3,
  postId: 7,
  title: '제목',
  contentSnippet: '본문',
  writer: '감자',
  writerProfileImageUrl: null,
  thumbnailImageUrl: null,
  createdAt: '2025-07-27T21:08:37.109',
  tags: [null],
};
const PAGE = new PagedResponse<LikeResponse>([LIKE], 0, 10, 1, 1);

// 서비스는 가짜다. 이 시험은 요청 해석(page, size, 경로의 글 번호), 메시지, 오류 코드, 접근 규칙을 본다.
// 쿼리의 의미는 like.repository.spec.ts가 진짜 MySQL로 증명한다. 사용자·토큰 저장소도 가짜라서 DB와 Redis가 필요 없다.
async function createApp() {
  const service = {
    getMyLikes: vi.fn().mockResolvedValue(PAGE),
    isPostLiked: vi.fn().mockResolvedValue(true),
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
    controllers: [LikeController],
    providers: [{ provide: LikeService, useValue: service }],
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

describe('좋아요 읽기 API', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createApp();
  });

  afterAll(() => t.app.close());

  beforeEach(() => vi.clearAllMocks());

  describe('GET /api/v1/likes/me', () => {
    it('토큰이 없으면 403 J004다', async () => {
      const res = await t.get('/api/v1/likes/me');
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J004' });
      expect(t.service.getMyLikes).not.toHaveBeenCalled();
    });

    it('로그인한 사용자의 githubId로 조회하고 HTTP 200에 옛 메시지와 쪽 정보를 준다', async () => {
      const res = await t.get('/api/v1/likes/me', t.bearer('octo'));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 200,
        message: '좋아요 목록 조회 성공',
        data: {
          content: [LIKE],
          page: 0,
          size: 10,
          totalElements: 1,
          totalPages: 1,
        },
        timestamp: expect.any(Number),
      });
    });

    it('값이 없는 이미지 주소는 null로, 태그가 없는 글의 태그는 [null]로 나간다', async () => {
      const res = await t.get('/api/v1/likes/me', t.bearer('octo'));
      expect(res.body.data.content[0]).toMatchObject({
        writerProfileImageUrl: null,
        thumbnailImageUrl: null,
        tags: [null],
      });
    });

    it('아무것도 없으면 0쪽, 크기 10이다', async () => {
      await t.get('/api/v1/likes/me', t.bearer('octo'));
      expect(t.service.getMyLikes).toHaveBeenCalledWith('octo', {
        page: 0,
        size: 10,
      });
    });

    it('page와 size를 읽는다', async () => {
      await t.get('/api/v1/likes/me?page=2&size=5', t.bearer('octo'));
      expect(t.service.getMyLikes).toHaveBeenCalledWith('octo', {
        page: 2,
        size: 5,
      });
    });

    // 어떤 값도 오류가 되지 않고 기본값으로 고쳐진다(Spring Data).
    it.each([
      ['page=abc&size=abc', { page: 0, size: 10 }],
      ['page=-3&size=0', { page: 0, size: 10 }],
      ['size=5000', { page: 0, size: 2000 }],
    ])('이상한 값(%s)은 오류 없이 고친다', async (query, expected) => {
      const res = await t.get(`/api/v1/likes/me?${query}`, t.bearer('octo'));
      expect(res.status).toBe(200);
      expect(t.service.getMyLikes).toHaveBeenCalledWith('octo', expected);
    });

    // 정렬은 좋아요를 누른 시각 내림차순으로 고정이라 요청의 sort를 서비스에 넘기지 않는다(옛 동작).
    it('요청의 sort는 무시한다(오류도 아니다)', async () => {
      const res = await t.get(
        '/api/v1/likes/me?sort=likeId,asc&sort=nothing',
        t.bearer('octo'),
      );
      expect(res.status).toBe(200);
      expect(t.service.getMyLikes).toHaveBeenCalledWith('octo', {
        page: 0,
        size: 10,
      });
    });

    it('ADMIN도 부를 수 있다', async () => {
      const res = await t.get('/api/v1/likes/me', t.bearer('boss'));
      expect(res.status).toBe(200);
    });

    // 기본 규칙은 USER, ADMIN이다. 가입을 끝내지 않은 사용자는 거부한다.
    it.each(['waiting', 'newbie'])(
      '%s(PENDING·PRE_REGISTER)는 403 J005다',
      async (id) => {
        const res = await t.get('/api/v1/likes/me', t.bearer(id));
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ data: 'J005' });
        expect(t.service.getMyLikes).not.toHaveBeenCalled();
      },
    );
  });

  describe('GET /api/v1/likes/{postId}/liked', () => {
    it('토큰이 없으면 403 J004다', async () => {
      const res = await t.get('/api/v1/likes/7/liked');
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J004' });
      expect(t.service.isPostLiked).not.toHaveBeenCalled();
    });

    it('로그인한 사용자의 githubId와 글 번호로 조회하고 옛 메시지를 준다', async () => {
      const res = await t.get('/api/v1/likes/7/liked', t.bearer('octo'));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 200,
        message: '좋아요 여부 조회 성공',
        data: true,
        timestamp: expect.any(Number),
      });
      expect(t.service.isPostLiked).toHaveBeenCalledWith('octo', 7n);
    });

    // data는 null일 때만 빠진다. false는 그대로 나간다(ResponseDto의 규칙).
    it('좋아요를 안 눌렀으면 data: false가 키째 나간다', async () => {
      t.service.isPostLiked.mockResolvedValueOnce(false);
      const res = await t.get('/api/v1/likes/7/liked', t.bearer('octo'));
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data', false);
    });

    it('없는 글이면 서비스가 던진 404 P001이 그대로 나간다', async () => {
      t.service.isPostLiked.mockRejectedValueOnce(
        new BusinessException(ErrorCode.POST_NOT_FOUND),
      );
      const res = await t.get('/api/v1/likes/999/liked', t.bearer('octo'));
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ status: 404, code: 'P001' });
    });

    // Spring의 Long 변환 규칙이다(NumberUtils.parseNumber): 공백을 지우고 16진수도 읽는다.
    it.each([
      ['0', 0n],
      ['-1', -1n],
      ['9223372036854775807', 9223372036854775807n],
      ['0x10', 16n],
      ['%2023', 23n], // " 23"
    ])('글 번호 %s를 %s로 읽는다', async (raw, expected) => {
      const res = await t.get(`/api/v1/likes/${raw}/liked`, t.bearer('octo'));
      expect(res.status).toBe(200);
      expect(t.service.isPostLiked).toHaveBeenCalledWith('octo', expected);
    });

    // 옛 MethodArgumentTypeMismatchException: 400 C005다.
    it.each(['abc', '1.5', '1e3', '9223372036854775808', '0x', '12abc'])(
      '글 번호가 숫자가 아니거나 범위 밖이면(%s) 400 C005다',
      async (raw) => {
        const res = await t.get(`/api/v1/likes/${raw}/liked`, t.bearer('octo'));
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({
          status: 400,
          code: 'C005',
          errors: [{ field: 'postId', value: raw, reason: 'typeMismatch' }],
        });
        expect(t.service.isPostLiked).not.toHaveBeenCalled();
      },
    );

    it.each(['waiting', 'newbie'])(
      '%s(PENDING·PRE_REGISTER)는 403 J005다',
      async (id) => {
        const res = await t.get('/api/v1/likes/7/liked', t.bearer(id));
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ data: 'J005' });
        expect(t.service.isPostLiked).not.toHaveBeenCalled();
      },
    );
  });
});
