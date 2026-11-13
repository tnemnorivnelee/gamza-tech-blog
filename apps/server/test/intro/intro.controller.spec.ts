import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CommonModule } from '../../src/common/common.module.js';
import { PagedResponse } from '../../src/common/dto/paged-response.dto.js';
import { validateEnv } from '../../src/config/env.validation.js';
import { AuthModule } from '../../src/modules/auth/auth.module.js';
import { InMemoryTokenStore } from '../../src/modules/auth/in-memory-token-store.js';
import { TokenStore } from '../../src/modules/auth/token-store.js';
import type { IntroResponse } from '../../src/modules/introduction/dto/intro-response.dto.js';
import { IntroController } from '../../src/modules/introduction/intro.controller.js';
import { IntroService } from '../../src/modules/introduction/intro.service.js';
import { UserRepository } from '../../src/modules/user/user.repository.js';

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
  const service = { getIntroList: vi.fn().mockResolvedValue(PAGE) };
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
    .useValue({ findByGithubId: () => Promise.resolve(undefined) })
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
  return { app, service, get };
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
