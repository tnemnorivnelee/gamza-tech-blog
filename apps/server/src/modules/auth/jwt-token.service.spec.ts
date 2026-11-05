import { ConfigModule } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { validateEnv } from '../../config/env.validation.js';
import { AuthModule } from './auth.module.js';
import { JwtTokenService } from './jwt-token.service.js';

// vitest.config.ts가 넣어 준 테스트용 키. 서비스가 만들지 않는 토큰(exp 없음, 다른 알고리즘 등)을
// 같은 키로 직접 서명해서 만든다.
const key = Buffer.from(process.env.JWT_SECRET ?? '', 'base64');
const signer = new JwtService({ secret: key });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const b64url = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
const part = (token: string, index: number) =>
  JSON.parse(Buffer.from(token.split('.')[index], 'base64url').toString());
const nowSeconds = () => Math.floor(Date.now() / 1000);

// 서비스가 만드는 토큰과 같은 모양의 기준 토큰. 부정 테스트는 여기서 딱 한 가지만 어긋나게 만든다.
// 기준과 두 군데 이상 다르면 다른 이유로 거부돼도 통과해 버려서, 무엇을 잡는 테스트인지 알 수 없다.
const SUBJECT = 'GamjaTech';
const validOptions: JwtSignOptions = { subject: SUBJECT, expiresIn: 60 };
const forge = (
  payload: object,
  options: JwtSignOptions = validOptions,
  jwt: JwtService = signer,
) => jwt.sign(payload, options);

describe('JwtTokenService', () => {
  let moduleRef: TestingModule;
  let service: JwtTokenService;

  beforeAll(async () => {
    // 환경변수 문자열 → validateEnv → 서비스까지 실제 경로를 지나게 한다.
    // 숫자 변환이 빠지면 "7200"이 밀리초로 읽혀 토큰이 7.2초 만에 만료된다.
    vi.stubEnv('ACCESS_TOKEN_TTL_SECONDS', '7200');
    vi.stubEnv('REFRESH_TOKEN_TTL_SECONDS', '86400');
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: validateEnv,
        }),
        AuthModule,
      ],
    }).compile();
    service = moduleRef.get(JwtTokenService);
  });

  afterAll(async () => {
    await moduleRef.close();
    vi.unstubAllEnvs();
  });

  describe('발급', () => {
    it('액세스 토큰은 HS256이고 클레임이 옛 JwtProvider와 같다(role 없음)', () => {
      const token = service.createAccessToken('octocat');
      const header = part(token, 0);
      const payload = part(token, 1);

      expect(header.alg).toBe('HS256');
      expect(Object.keys(payload).sort()).toEqual([
        'exp',
        'githubId',
        'iat',
        'jti',
        'sub',
      ]);
      expect(payload).toMatchObject({ sub: 'GamjaTech', githubId: 'octocat' });
      expect(payload.jti).toMatch(UUID);
      expect(payload.exp - payload.iat).toBe(7200);
    });

    it('리프레시 토큰은 같은 방식이고 수명만 다르다', () => {
      const payload = part(service.createRefreshToken('octocat'), 1);
      expect(payload).toMatchObject({ sub: 'GamjaTech', githubId: 'octocat' });
      expect(payload.exp - payload.iat).toBe(86400);
    });

    it('토큰마다 jti가 다르다', () => {
      const a = part(service.createAccessToken('octocat'), 1).jti;
      const b = part(service.createAccessToken('octocat'), 1).jti;
      expect(a).not.toBe(b);
    });
  });

  describe('검증', () => {
    it('유효한 액세스 토큰은 githubId를 돌려준다', () => {
      expect(service.verify(service.createAccessToken('octocat'))).toBe(
        'octocat',
      );
    });

    it('유효한 리프레시 토큰도 같은 방식으로 통과한다(옛 동작: 둘을 구별하지 않는다)', () => {
      expect(service.verify(service.createRefreshToken('octocat'))).toBe(
        'octocat',
      );
    });

    it('만료된 토큰은 null이다', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const token = service.createAccessToken('octocat');
        vi.setSystemTime(Date.now() + 7201 * 1000);
        expect(service.verify(token)).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    // 대조군: 아래 부정 케이스는 모두 이 토큰에서 한 가지만 어긋난다.
    // 이것이 통과하지 않으면 부정 케이스의 null이 의미가 없다.
    it('기준 토큰(대조군)은 통과한다', () => {
      expect(service.verify(forge({ githubId: 'octocat' }))).toBe('octocat');
    });

    // 옛 JwtProvider는 서명과 만료만 확인했고 sub는 보지 않았다. 옛 동작을 고정한다.
    it('sub가 달라도 통과한다(옛 동작)', () => {
      const token = forge(
        { githubId: 'octocat' },
        { ...validOptions, subject: 'other' },
      );
      expect(service.verify(token)).toBe('octocat');
    });

    // 옛 validateAccessToken은 이유를 구분하지 않고 false였다. 전부 null이다.
    it.each([
      [
        '다른 키로 서명',
        () =>
          forge(
            { githubId: 'octocat' },
            validOptions,
            new JwtService({ secret: Buffer.alloc(32, 'x') }),
          ),
      ],
      [
        'payload를 바꿔치기(서명은 그대로)',
        () => {
          const token = forge({ githubId: 'octocat' });
          const [header, , signature] = token.split('.');
          const forged = b64url({ ...part(token, 1), githubId: 'attacker' });
          return [header, forged, signature].join('.');
        },
      ],
      // exp는 필수다([확정]). jsonwebtoken은 기본으로 요구하지 않는다.
      [
        'exp가 없음',
        () => forge({ githubId: 'octocat' }, { subject: SUBJECT }),
      ],
      // 같은 키로 서명한 HS384·HS512도 기본 설정이면 통과한다. HS256만 받는다.
      [
        'HS384로 서명',
        () =>
          forge(
            { githubId: 'octocat' },
            { ...validOptions, algorithm: 'HS384' },
          ),
      ],
      [
        'alg가 none',
        () =>
          `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: SUBJECT, githubId: 'octocat', exp: nowSeconds() + 60 })}.`,
      ],
      ['githubId가 문자열이 아님', () => forge({ githubId: 123 })],
      ['githubId가 없음', () => forge({})],
      ['빈 문자열', () => ''],
      ['토큰 모양이 아님', () => 'not-a-jwt'],
      ['점 세 조각이지만 쓰레기', () => 'a.b.c'],
    ])('%s이면 null이다', (_name, makeToken) => {
      expect(service.verify(makeToken())).toBeNull();
    });
  });
});
