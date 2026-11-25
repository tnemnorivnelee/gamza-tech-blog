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
import type { IntroResponse } from '../../src/modules/introduction/dto/intro-response.dto.js';
import { IntroController } from '../../src/modules/introduction/intro.controller.js';
import { IntroService } from '../../src/modules/introduction/intro.service.js';
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

const INTRO: IntroResponse = {
  introId: 1,
  userId: 2,
  nickname: '감자',
  profileImageUrl: null,
  content: '안녕하세요',
  createdAt: '2025-07-27T21:08:37.109',
};
const PAGE = new PagedResponse<IntroResponse>([INTRO], 0, 10, 1, 1);

// 서비스는 가짜다. 이 시험은 요청 해석(page, size, sort), 메시지, 접근 규칙을 본다.
// 쿼리의 의미는 intro.repository.spec.ts가 진짜 MySQL로 증명한다. 사용자·토큰 저장소도 가짜라서 DB와 Redis가 필요 없다.
async function createApp() {
  const service = {
    getIntroList: vi.fn().mockResolvedValue(PAGE),
    createIntro: vi.fn().mockResolvedValue(INTRO),
    deleteIntro: vi.fn().mockResolvedValue(undefined),
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
    controllers: [IntroController],
    providers: [{ provide: IntroService, useValue: service }],
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
  const get = async (path: string) => {
    const res = await fetch(`${baseUrl}${path}`);
    return { status: res.status, body: await res.json() };
  };
  // body가 있으면 JSON으로 보낸다. 쓰기 API(POST, DELETE) 시험이 쓴다.
  const send = async (
    method: 'POST' | 'DELETE',
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

describe('GET /api/v1/intros', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createApp();
  });

  afterAll(() => t.app.close());

  beforeEach(() => vi.clearAllMocks());

  it('토큰 없이도 부를 수 있고, HTTP 200에 옛 메시지와 쪽 정보를 준다', async () => {
    const res = await t.get('/api/v1/intros');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 200,
      message: '자기소개 목록 조회 성공',
      data: {
        content: [INTRO],
        page: 0,
        size: 10,
        totalElements: 1,
        totalPages: 1,
      },
      timestamp: expect.any(Number),
    });
  });

  it('값이 없는 프로필 이미지는 키가 빠지지 않고 null로 나간다', async () => {
    const res = await t.get('/api/v1/intros');
    expect(res.body.data.content[0]).toHaveProperty('profileImageUrl', null);
  });

  it('아무것도 없으면 0쪽, 크기 10, createdAt 내림차순이다', async () => {
    await t.get('/api/v1/intros');
    expect(t.service.getIntroList).toHaveBeenCalledWith({ page: 0, size: 10 }, [
      { property: 'createdAt', direction: 'desc' },
    ]);
  });

  it('page와 size를 읽는다', async () => {
    await t.get('/api/v1/intros?page=2&size=5');
    expect(t.service.getIntroList.mock.calls[0][0]).toEqual({
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
    const res = await t.get(`/api/v1/intros?${query}`);
    expect(res.status).toBe(200);
    expect(t.service.getIntroList.mock.calls[0][0]).toEqual(expected);
  });

  // 글 목록과 달리 소개 목록은 요청의 sort를 반영한다. 요청의 sort는 기본 정렬을 바꾼다(더하지 않는다).
  // Spring은 sort[]를 sort로 읽지 않는다. Express 5의 기본 쿼리 해석기(querystring)도 sort[]를 다른 이름으로 둬서 같다.
  it('sort[]=id,asc(대괄호)는 sort가 아니라서 기본 정렬이다', async () => {
    await t.get('/api/v1/intros?sort[]=id,asc');
    expect(t.service.getIntroList.mock.calls[0][1]).toEqual([
      { property: 'createdAt', direction: 'desc' },
    ]);
  });

  it.each([
    ['sort=id,asc', [{ property: 'id', direction: 'asc' }]],
    ['sort=createdAt', [{ property: 'createdAt', direction: 'asc' }]],
    [
      'sort=createdAt,desc&sort=id,asc',
      [
        { property: 'createdAt', direction: 'desc' },
        { property: 'id', direction: 'asc' },
      ],
    ],
    ['sort=', [{ property: 'createdAt', direction: 'desc' }]],
  ])('%s를 정렬로 읽는다', async (query, expected) => {
    await t.get(`/api/v1/intros?${query}`);
    expect(t.service.getIntroList.mock.calls[0][1]).toEqual(expected);
  });
});

describe('POST /api/v1/intros', () => {
  let t: TestApp;
  const url = '/api/v1/intros';

  beforeAll(async () => {
    t = await createApp();
  });

  afterAll(() => t.app.close());

  beforeEach(() => vi.clearAllMocks());

  it('토큰이 없으면 403 J004다(목록 조회와 달리 공개가 아니다)', async () => {
    const res = await t.send('POST', url, {}, { content: '안녕하세요' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ data: 'J004' });
    expect(t.service.createIntro).not.toHaveBeenCalled();
  });

  // 옛 ResponseDto.of(CREATED, "자기소개 작성 성공", ...)이다: HTTP는 200이고 본문 status만 201이다.
  it('로그인한 사용자의 githubId와 내용으로 쓰고 HTTP 200에 본문 status 201과 만든 소개를 준다', async () => {
    const res = await t.send('POST', url, t.bearer('octo'), {
      content: '안녕하세요',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 201,
      message: '자기소개 작성 성공',
      data: INTRO,
      timestamp: expect.any(Number),
    });
    expect(t.service.createIntro).toHaveBeenCalledWith('octo', '안녕하세요');
  });

  it('ADMIN도 쓸 수 있다', async () => {
    const res = await t.send('POST', url, t.bearer('boss'), {
      content: '안녕하세요',
    });
    expect(res.status).toBe(200);
    expect(t.service.createIntro).toHaveBeenCalledWith('boss', '안녕하세요');
  });

  // 옛 @Valid: 서비스에 가기 전에 400 C001과 필드별 오류(필드, 거부된 값, 규칙의 메시지)다.
  it('내용이 비어 있으면 400 C001과 필드 오류이고 서비스를 부르지 않는다', async () => {
    const res = await t.send('POST', url, t.bearer('octo'), { content: '   ' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      status: 400,
      code: 'C001',
      errors: [
        {
          field: 'content',
          value: '   ',
          reason: '자기소개 내용은 필수입니다.',
        },
      ],
    });
    expect(t.service.createIntro).not.toHaveBeenCalled();
  });

  it('내용이 없으면 400 C001이다(거부된 값은 빈 문자열)', async () => {
    const res = await t.send('POST', url, t.bearer('octo'), {});
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      { field: 'content', value: '', reason: '자기소개 내용은 필수입니다.' },
    ]);
  });

  it.each(['가', '가'.repeat(1001)])(
    '길이가 2~1000자가 아니면 400 C001이다(%#)',
    async (content) => {
      const res = await t.send('POST', url, t.bearer('octo'), { content });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        code: 'C001',
        errors: [
          {
            field: 'content',
            value: content,
            reason: '자기소개는 2~1000자 사이로 입력하세요.',
          },
        ],
      });
      expect(t.service.createIntro).not.toHaveBeenCalled();
    },
  );

  it('이미 썼으면 서비스가 던진 409 IN001이 그대로 나간다', async () => {
    t.service.createIntro.mockRejectedValueOnce(
      new BusinessException(ErrorCode.INTRO_ALREADY_EXISTS),
    );
    const res = await t.send('POST', url, t.bearer('octo'), {
      content: '안녕하세요',
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ status: 409, code: 'IN001' });
  });

  // 검사(400)가 서비스(409)보다 먼저다. 옛 @Valid도 컨트롤러 메서드에 들어가기 전에 돌았다.
  it('내용이 잘못되면 이미 썼는지 보기 전에 400이다', async () => {
    t.service.createIntro.mockRejectedValue(
      new BusinessException(ErrorCode.INTRO_ALREADY_EXISTS),
    );
    const res = await t.send('POST', url, t.bearer('octo'), { content: '가' });
    expect(res.status).toBe(400);
  });

  it.each(['waiting', 'newbie'])(
    '%s(PENDING·PRE_REGISTER)는 403 J005다',
    async (id) => {
      const res = await t.send('POST', url, t.bearer(id), {
        content: '안녕하세요',
      });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J005' });
      expect(t.service.createIntro).not.toHaveBeenCalled();
    },
  );
});

describe('DELETE /api/v1/intros/{introId}', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createApp();
  });

  afterAll(() => t.app.close());

  beforeEach(() => vi.clearAllMocks());

  it('토큰이 없으면 403 J004다', async () => {
    const res = await t.send('DELETE', '/api/v1/intros/3');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ data: 'J004' });
    expect(t.service.deleteIntro).not.toHaveBeenCalled();
  });

  it('로그인한 사용자의 githubId와 소개 번호로 지우고, 본문 status 200과 옛 메시지를 준다(data 없음)', async () => {
    const res = await t.send('DELETE', '/api/v1/intros/3', t.bearer('octo'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 200,
      message: '자기소개 삭제 성공',
      timestamp: expect.any(Number),
    });
    expect(res.body).not.toHaveProperty('data');
    expect(t.service.deleteIntro).toHaveBeenCalledWith('octo', 3n);
  });

  it('없으면 404 IN002, 쓴 사람이 아니면 403 IN003이 그대로 나간다', async () => {
    t.service.deleteIntro.mockRejectedValueOnce(
      new BusinessException(ErrorCode.INTRO_NOT_FOUND),
    );
    t.service.deleteIntro.mockRejectedValueOnce(
      new BusinessException(ErrorCode.INTRO_DELETE_FORBIDDEN),
    );
    const missing = await t.send(
      'DELETE',
      '/api/v1/intros/999',
      t.bearer('octo'),
    );
    const forbidden = await t.send(
      'DELETE',
      '/api/v1/intros/3',
      t.bearer('octo'),
    );
    expect(missing).toMatchObject({ status: 404, body: { code: 'IN002' } });
    expect(forbidden).toMatchObject({ status: 403, body: { code: 'IN003' } });
  });

  it.each(['abc', '1.5', '12abc'])(
    '소개 번호가 숫자가 아니면(%s) 400 C005다',
    async (raw) => {
      const res = await t.send(
        'DELETE',
        `/api/v1/intros/${raw}`,
        t.bearer('octo'),
      );
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        status: 400,
        code: 'C005',
        errors: [{ field: 'introId', value: raw, reason: 'typeMismatch' }],
      });
      expect(t.service.deleteIntro).not.toHaveBeenCalled();
    },
  );

  it.each(['waiting', 'newbie'])(
    '%s(PENDING·PRE_REGISTER)는 403 J005다',
    async (id) => {
      const res = await t.send('DELETE', '/api/v1/intros/3', t.bearer(id));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J005' });
      expect(t.service.deleteIntro).not.toHaveBeenCalled();
    },
  );
});
