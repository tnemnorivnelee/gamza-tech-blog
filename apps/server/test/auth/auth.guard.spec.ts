import { Controller, Get, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { CommonModule } from '../../src/common/common.module.js';
import { setupSwagger } from '../../src/common/swagger/setup-swagger.js';
import { validateEnv } from '../../src/config/env.validation.js';
import { Public, Roles } from '../../src/modules/auth/access.decorator.js';
import { AuthModule } from '../../src/modules/auth/auth.module.js';
import { CurrentUser } from '../../src/modules/auth/current-user.decorator.js';
import { InMemoryTokenStore } from '../../src/modules/auth/in-memory-token-store.js';
import { JwtTokenService } from '../../src/modules/auth/jwt-token.service.js';
import { TokenStore } from '../../src/modules/auth/token-store.js';
import {
  type User,
  UserRepository,
} from '../../src/modules/user/user.repository.js';

// 가드 시험용 컨트롤러. 응답은 가드가 request.user에 무엇을 붙였는지만 보여 준다.
const who = (user?: User) => ({ githubId: user?.githubId ?? null });

@Controller('fx')
class FixtureController {
  // 꼬리표가 없으면 기본 규칙(USER, ADMIN)이다.
  @Get('default')
  byDefault(@CurrentUser() user?: User) {
    return who(user);
  }

  @Public()
  @Get('public')
  open(@CurrentUser() user?: User) {
    return who(user);
  }

  @Roles('ADMIN')
  @Get('admin')
  adminOnly(@CurrentUser() user?: User) {
    return who(user);
  }

  @Roles('USER', 'PRE_REGISTER', 'PENDING', 'ADMIN')
  @Get('all-roles')
  anyRole(@CurrentUser() user?: User) {
    return who(user);
  }

  @Roles('PRE_REGISTER')
  @Get('pre-register')
  preRegisterOnly(@CurrentUser() user?: User) {
    return who(user);
  }
}

// 클래스에 붙인 꼬리표와 메서드에 붙인 꼬리표가 겹칠 때: 메서드가 이긴다.
@Roles('ADMIN')
@Controller('fx-class')
class ClassLevelController {
  @Get('inherit')
  inherit(@CurrentUser() user?: User) {
    return who(user);
  }

  @Public()
  @Get('public')
  open(@CurrentUser() user?: User) {
    return who(user);
  }

  @Roles('USER')
  @Get('override')
  override(@CurrentUser() user?: User) {
    return who(user);
  }
}

// 클래스에 @Public이 있으면 메서드에 @Roles를 붙여도 공개다. 대부분 공개인 컨트롤러를 옮길 때 로그인이 필요한 메서드를 놓치기 쉽다.
@Public()
@Controller('fx-public-class')
class PublicClassController {
  @Roles('ADMIN')
  @Get('admin')
  adminLooking(@CurrentUser() user?: User) {
    return who(user);
  }
}

const USERS = new Map<string, User>([
  ['octo', { githubId: 'octo', role: 'USER', email: null }],
  ['boss', { githubId: 'boss', role: 'ADMIN', email: null }],
  ['newbie', { githubId: 'newbie', role: 'PRE_REGISTER', email: null }],
  ['waiting', { githubId: 'waiting', role: 'PENDING', email: null }],
]);

describe('AuthGuard', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let baseUrl: string;
  let jwt: JwtTokenService;
  let tokenStore: TokenStore;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: validateEnv,
        }),
        CommonModule,
        AuthModule,
      ],
      controllers: [
        FixtureController,
        ClassLevelController,
        PublicClassController,
      ],
    })
      // 사용자 저장소와 토큰 저장소를 시험용으로 바꿔 끼운다. src에는 시험용 시드 기능을 두지 않았다.
      // 토큰 저장소는 가짜(메모리)를 쓴다. 가드 규칙을 보는 시험이라 Redis가 필요 없다.
      .overrideProvider(UserRepository)
      .useValue({
        findByGithubId: (githubId: string) =>
          Promise.resolve(USERS.get(githubId)),
      })
      .overrideProvider(TokenStore)
      .useClass(InMemoryTokenStore)
      .compile();
    app = moduleRef.createNestApplication();
    setupSwagger(app);
    await app.listen(0);
    baseUrl = await app.getUrl();
    jwt = moduleRef.get(JwtTokenService);
    tokenStore = moduleRef.get(TokenStore);
  });

  afterAll(() => app.close());

  const call = async (path: string, headers: Record<string, string> = {}) => {
    const res = await fetch(`${baseUrl}${path}`, { headers });
    return { status: res.status, body: await res.json() };
  };
  const bearer = (githubId: string) => ({
    authorization: `Bearer ${jwt.createAccessToken(githubId)}`,
  });
  // 2시간 전에 만든 토큰이라 이미 만료됐다(기본 수명 1시간).
  const expiredToken = (githubId: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() - 2 * 3600 * 1000);
      return jwt.createAccessToken(githubId);
    } finally {
      vi.useRealTimers();
    }
  };

  // 인증 실패는 ErrorResponse가 아니라 ResponseDto 모양이다. data에 코드가 들어가고 code 키는 없다.
  const expectFailure = (
    res: { status: number; body: unknown },
    status: number,
    code: string,
  ) => {
    expect(res.status).toBe(status);
    expect(res.body).toEqual({
      status,
      message: expect.any(String),
      data: code,
      timestamp: expect.any(Number),
    });
  };

  describe('토큰 찾기와 검증', () => {
    it('유효한 토큰이면 통과하고 @CurrentUser로 사용자가 들어온다', async () => {
      const res = await call('/fx/default', bearer('octo'));
      expect(res).toEqual({ status: 200, body: { githubId: 'octo' } });
    });

    it('토큰이 없으면 403 J004', async () => {
      expectFailure(await call('/fx/default'), 403, 'J004');
    });

    it('ACCESS 헤더도 Bearer가 필요하다. 접두어가 없으면 오류가 아니라 없는 것으로 본다(403 J004)', async () => {
      const token = jwt.createAccessToken('octo');
      expectFailure(await call('/fx/default', { access: token }), 403, 'J004');
    });

    it('ACCESS에 접두어가 없으면 건너뛰고 Authorization을 쓴다', async () => {
      const res = await call('/fx/default', {
        access: 'raw-token',
        ...bearer('octo'),
      });
      expect(res.body).toEqual({ githubId: 'octo' });
    });

    it('ACCESS가 Authorization보다 먼저다', async () => {
      const res = await call('/fx/default', {
        access: `Bearer ${jwt.createAccessToken('boss')}`,
        ...bearer('octo'),
      });
      expect(res.body).toEqual({ githubId: 'boss' });
    });

    it('소문자 bearer는 없는 것으로 본다(403 J004)', async () => {
      const token = jwt.createAccessToken('octo');
      expectFailure(
        await call('/fx/default', { authorization: `bearer ${token}` }),
        403,
        'J004',
      );
    });

    it.each(['authorization', 'accessToken'])(
      '%s 쿠키의 값을 그대로 토큰으로 쓴다',
      async (name) => {
        const res = await call('/fx/default', {
          cookie: `${name}=${jwt.createAccessToken('octo')}`,
        });
        expect(res.body).toEqual({ githubId: 'octo' });
      },
    );

    it('쿠키가 헤더보다 먼저다', async () => {
      const res = await call('/fx/default', {
        cookie: `authorization=${jwt.createAccessToken('boss')}`,
        ...bearer('octo'),
      });
      expect(res.body).toEqual({ githubId: 'boss' });
    });

    it('빈 쿠키는 건너뛰고 헤더를 쓴다', async () => {
      const res = await call('/fx/default', {
        cookie: 'authorization=',
        ...bearer('octo'),
      });
      expect(res.body).toEqual({ githubId: 'octo' });
    });

    it('쿠키 값에 Bearer를 붙이면 토큰 모양이 아니라서 400 C005', async () => {
      const token = jwt.createAccessToken('octo');
      expectFailure(
        await call('/fx/default', { cookie: `authorization=Bearer ${token}` }),
        400,
        'C005',
      );
    });

    // "Bearer " 뒤가 빈 경우는 access-token.spec.ts가 다룬다. HTTP 클라이언트가 끝 공백을 잘라 보내서 여기서는 만들 수 없다.
    it('토큰 모양이 아니면 400 C005', async () => {
      expectFailure(
        await call('/fx/default', { authorization: 'Bearer not-a-jwt' }),
        400,
        'C005',
      );
    });

    it('서명이 다른 토큰은 400 C005', async () => {
      const token = jwt.createAccessToken('octo');
      const tampered = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`;
      expectFailure(
        await call('/fx/default', { authorization: `Bearer ${tampered}` }),
        400,
        'C005',
      );
    });

    // 만료도 403이 아니라 400 C005다. 이상해 보여도 옛 동작이다.
    it('만료된 토큰은 400 C005', async () => {
      expectFailure(
        await call('/fx/default', {
          authorization: `Bearer ${expiredToken('octo')}`,
        }),
        400,
        'C005',
      );
    });

    it('블랙리스트에 오른 토큰은 403 J001', async () => {
      const token = jwt.createAccessToken('octo');
      const headers = { authorization: `Bearer ${token}` };
      expect((await call('/fx/default', headers)).status).toBe(200);

      await tokenStore.blacklistAccessToken(token, 60);
      expectFailure(await call('/fx/default', headers), 403, 'J001');
    });

    it('토큰은 맞는데 저장소에 사용자가 없으면 403 J005', async () => {
      expectFailure(await call('/fx/default', bearer('ghost')), 403, 'J005');
    });
  });

  // 검사 순서는 옛 필터와 같다: 찾기 → 서명·만료 → 블랙리스트 → 사용자 → role.
  describe('검사 순서', () => {
    it('만료됐고 블랙리스트에도 있으면 C005가 먼저다', async () => {
      const token = expiredToken('octo');
      await tokenStore.blacklistAccessToken(token, 60);
      expectFailure(
        await call('/fx/default', { authorization: `Bearer ${token}` }),
        400,
        'C005',
      );
    });

    it('블랙리스트에 있고 사용자도 없으면 J001이 먼저다', async () => {
      const token = jwt.createAccessToken('ghost');
      await tokenStore.blacklistAccessToken(token, 60);
      expectFailure(
        await call('/fx/default', { authorization: `Bearer ${token}` }),
        403,
        'J001',
      );
    });

    it('사용자가 없으면 role 검사 전에 J005다', async () => {
      expectFailure(await call('/fx/admin', bearer('ghost')), 403, 'J005');
    });
  });

  describe('공개 라우트', () => {
    it('토큰이 없어도 통과한다', async () => {
      expect(await call('/fx/public')).toEqual({
        status: 200,
        body: { githubId: null },
      });
    });

    it('쓰레기 토큰이나 블랙리스트 토큰이어도 통과한다(검사 자체를 건너뛴다)', async () => {
      const token = jwt.createAccessToken('octo');
      await tokenStore.blacklistAccessToken(token, 60);
      const res = await call('/fx/public', {
        authorization: `Bearer ${token}`,
      });
      expect(res.status).toBe(200);
      expect(
        (await call('/fx/public', { authorization: 'Bearer x' })).status,
      ).toBe(200);
    });

    it('유효한 토큰을 보내도 사용자 정보는 붙지 않는다', async () => {
      const res = await call('/fx/public', bearer('octo'));
      expect(res.body).toEqual({ githubId: null });
    });
  });

  // role이 안 맞을 때도 403 J005 + ResponseDto 모양이다(D1, 옛 응답은 미검증).
  describe('role 규칙', () => {
    it('기본 규칙은 USER와 ADMIN만 통과시킨다', async () => {
      expect((await call('/fx/default', bearer('octo'))).status).toBe(200);
      expect((await call('/fx/default', bearer('boss'))).status).toBe(200);
      expectFailure(await call('/fx/default', bearer('newbie')), 403, 'J005');
      expectFailure(await call('/fx/default', bearer('waiting')), 403, 'J005');
    });

    it('@Roles("ADMIN")은 ADMIN만 통과시킨다', async () => {
      expect((await call('/fx/admin', bearer('boss'))).status).toBe(200);
      expectFailure(await call('/fx/admin', bearer('octo')), 403, 'J005');
    });

    it('@Roles로 네 role을 모두 허용할 수 있다', async () => {
      for (const id of USERS.keys()) {
        expect((await call('/fx/all-roles', bearer(id))).status).toBe(200);
      }
    });

    it('@Roles("PRE_REGISTER")은 PRE_REGISTER만 통과시킨다', async () => {
      expect((await call('/fx/pre-register', bearer('newbie'))).status).toBe(
        200,
      );
      for (const id of ['octo', 'boss', 'waiting']) {
        expectFailure(await call('/fx/pre-register', bearer(id)), 403, 'J005');
      }
    });

    it('클래스에 붙인 @Roles가 메서드 기본값이 된다', async () => {
      expect((await call('/fx-class/inherit', bearer('boss'))).status).toBe(
        200,
      );
      expectFailure(
        await call('/fx-class/inherit', bearer('octo')),
        403,
        'J005',
      );
    });

    it('메서드의 @Roles가 클래스의 @Roles를 통째로 바꾼다', async () => {
      expect((await call('/fx-class/override', bearer('octo'))).status).toBe(
        200,
      );
      expectFailure(
        await call('/fx-class/override', bearer('boss')),
        403,
        'J005',
      );
    });

    it('메서드의 @Public이 클래스의 @Roles보다 먼저다', async () => {
      expect((await call('/fx-class/public')).status).toBe(200);
    });

    it('클래스의 @Public은 메서드의 @Roles에도 이긴다(공개를 끌 수 없다)', async () => {
      expect((await call('/fx-public-class/admin')).status).toBe(200);
    });
  });

  // 옛 서버는 /v3/api-docs/**와 /swagger-ui/**를 열어 두었다. 전역 가드가 이 경로를 막으면 안 된다.
  describe('명세 문서 경로', () => {
    it.each(['/v3/api-docs/all', '/swagger-ui'])(
      '%s는 토큰 없이 200이다',
      async (path) => {
        const res = await fetch(`${baseUrl}${path}`);
        expect(res.status).toBe(200);
      },
    );
  });
});
