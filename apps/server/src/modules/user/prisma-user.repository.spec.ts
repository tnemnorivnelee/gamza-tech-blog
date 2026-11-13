import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import {
  databaseReachable as reachable,
  databaseUrl as url,
} from '../../../test/support/test-database.js';
import { PrismaUserRepository } from './prisma-user.repository.js';
import type { NewUser } from './user.repository.js';

// 진짜 MySQL로 하는 시험이다(m4-prisma-plan.md D8). unique 제약, SQL의 비어 있음 판정, 시각의 시간대는 가짜로는 증명할 수 없다.
// 접속과 건너뛰기 판단은 test/support/test-database.ts가 한다.

// 시험이 만든 사용자의 githubId 접두사. 실제 회원은 g_<숫자>라서 겹치지 않는다. 시험마다 끝나면 이 접두사 행만 지운다.
// 개발용 DB에는 복원한 실제 데이터가 있으므로 다른 행은 건드리지 않는다.
const PREFIX = 'g_test_';

describe.skipIf(!reachable)('PrismaUserRepository (진짜 MySQL)', () => {
  let prisma: PrismaService;
  let repo: PrismaUserRepository;

  // 시험마다 새 값을 쓴다. 서로 겹치지 않고, 개발용 DB에 이미 있는 데이터와도 겹치지 않는다.
  const newUser = (override: Partial<NewUser> = {}): NewUser => {
    const id = randomUUID();
    return {
      githubId: `${PREFIX}${id}`,
      role: 'PRE_REGISTER',
      email: `${id}@example.test`,
      name: '한글 이름',
      nickname: `nick-${id}`,
      ...override,
    };
  };

  // KST 벽시계 문자열("2026-11-10 09:30:00")을 UTC로 읽은 밀리초. DB에 들어 있는 값과 같은 방식으로 비교하려고 쓴다.
  const wallClockMs = (text: string) =>
    Date.parse(`${text.replace(' ', 'T')}Z`);
  // 지금의 서울 시각. 코드의 +9시간 상수를 쓰지 않고 Intl로 따로 구해서, 상수가 틀리면 시험이 잡는다.
  const seoulNowMs = () =>
    wallClockMs(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }));
  // DB가 저장한 날짜·시각을 아무 변환 없이 문자열로 읽는다(Prisma의 Date 변환을 거치지 않는다).
  const rawTimes = async (githubId: string) => {
    const [row] = await prisma.$queryRaw<
      { created: string; updated: string }[]
    >`
      SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created,
             DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated
      FROM users WHERE github_id = ${githubId}`;
    if (!row) throw new Error('시험용 행이 없습니다');
    return row;
  };

  beforeAll(() => {
    prisma = new PrismaService(
      new ConfigService<EnvironmentVariables, true>({ DATABASE_URL: url }),
    );
    repo = new PrismaUserRepository(prisma);
  });

  afterEach(async () => {
    await prisma.user.deleteMany({
      where: { githubId: { startsWith: PREFIX } },
    });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe('찾기와 만들기', () => {
    it('만든 사용자를 githubId로 찾는다(가드와 로그인이 쓰는 세 값)', async () => {
      const user = newUser({ role: 'USER' });
      await repo.create(user);
      expect(await repo.findByGithubId(user.githubId)).toEqual({
        githubId: user.githubId,
        role: 'USER',
        email: user.email,
      });
    });

    it('없는 githubId는 undefined다', async () => {
      expect(await repo.findByGithubId(`${PREFIX}없음`)).toBeUndefined();
    });

    it('이메일이 없는(비공개) 사용자도 만든다', async () => {
      const user = newUser({ email: null });
      await repo.create(user);
      expect((await repo.findByGithubId(user.githubId))?.email).toBeNull();
    });

    it('이름과 닉네임은 한글도 깨지지 않고 저장되고, 만들 때 두 시각은 같다', async () => {
      const user = newUser({
        name: '감자 블로그',
        nickname: `감자-${randomUUID()}`,
      });
      await repo.create(user);
      const row = await prisma.user.findUniqueOrThrow({
        where: { githubId: user.githubId },
      });
      expect(row.name).toBe('감자 블로그');
      expect(row.nickname).toBe(user.nickname);
      expect(row.role).toBe('PRE_REGISTER');
      expect(row.createdAt.getTime()).toBe(row.updatedAt.getTime());
    });

    // 같은 값은 DB의 unique 제약이 거부하고 예외가 그대로 올라간다(P2002). 옛 JPA와 같다.
    it.each(['githubId', 'nickname', 'email'] as const)(
      '%s가 겹치면 거부한다',
      async (field) => {
        const first = newUser();
        await repo.create(first);
        const second = newUser({ [field]: first[field] } as Partial<NewUser>);
        await expect(repo.create(second)).rejects.toMatchObject({
          code: 'P2002',
        });
      },
    );
  });

  describe('시각(created_at, updated_at)', () => {
    // 옛 행은 KST 벽시계 값으로 보인다(m4-prisma-plan.md 4절). 새 행도 같은 기준이어야 9시간 어긋나지 않는다.
    // 서버 프로세스의 시간대와 무관해야 해서, 이 시험은 TZ=UTC, TZ=Asia/Seoul, TZ=America/Los_Angeles로도 돌려 확인했다.
    it('DB에 서울 시각의 벽시계 값으로 들어간다', async () => {
      const user = newUser();
      await repo.create(user);
      const times = await rawTimes(user.githubId);
      for (const text of [times.created, times.updated]) {
        expect(Math.abs(wallClockMs(text) - seoulNowMs())).toBeLessThan(30_000);
      }
    });

    it('DB에 저장된 벽시계 값을 읽으면 같은 값의 Date(UTC 필드)로 나온다', async () => {
      const user = newUser();
      await repo.create(user);
      const row = await prisma.user.findUniqueOrThrow({
        where: { githubId: user.githubId },
      });
      const { created } = await rawTimes(user.githubId);
      expect(row.createdAt.toISOString().slice(0, 19).replace('T', ' ')).toBe(
        created,
      );
    });
  });

  describe('updateEmailIfEmpty', () => {
    it('이메일이 비어 있으면(null) 채운다', async () => {
      const user = newUser({ email: null });
      await repo.create(user);
      await repo.updateEmailIfEmpty(user.githubId, 'filled@example.test');
      expect((await repo.findByGithubId(user.githubId))?.email).toBe(
        'filled@example.test',
      );
    });

    // 옛 StringUtils.hasText와 같다: 공백만 있는 값도 비어 있는 것이다.
    it.each(['', '   '])(
      '이메일이 %j이면 비어 있는 것으로 보고 채운다',
      async (blank) => {
        const user = newUser({ email: blank });
        await repo.create(user);
        await repo.updateEmailIfEmpty(user.githubId, 'filled@example.test');
        expect((await repo.findByGithubId(user.githubId))?.email).toBe(
          'filled@example.test',
        );
      },
    );

    it('이미 있으면 덮어쓰지 않고 updated_at도 바꾸지 않는다', async () => {
      const user = newUser();
      await repo.create(user);
      const old = new Date('2020-01-01T00:00:00Z');
      await prisma.user.update({
        where: { githubId: user.githubId },
        data: { updatedAt: old },
      });
      await repo.updateEmailIfEmpty(user.githubId, 'other@example.test');
      const row = await prisma.user.findUniqueOrThrow({
        where: { githubId: user.githubId },
      });
      expect(row.email).toBe(user.email);
      expect(row.updatedAt.getTime()).toBe(old.getTime());
    });

    it('채울 때 updated_at이 서울 시각으로 갱신된다', async () => {
      const user = newUser({ email: null });
      await repo.create(user);
      await prisma.user.update({
        where: { githubId: user.githubId },
        data: { updatedAt: new Date('2020-01-01T00:00:00Z') },
      });
      await repo.updateEmailIfEmpty(user.githubId, 'filled@example.test');
      const { updated } = await rawTimes(user.githubId);
      expect(Math.abs(wallClockMs(updated) - seoulNowMs())).toBeLessThan(
        30_000,
      );
    });

    // WHERE의 괄호가 빠지면 "그 사용자이고 비어 있음"이 "그 사용자이거나 비어 있음"으로 바뀌어 다른 사용자의 이메일까지 바뀐다.
    it('다른 사용자의 비어 있는 이메일은 건드리지 않는다', async () => {
      const target = newUser({ email: null });
      const other = newUser({ email: '   ' });
      await repo.create(target);
      await repo.create(other);
      await repo.updateEmailIfEmpty(target.githubId, 'filled@example.test');
      expect((await repo.findByGithubId(target.githubId))?.email).toBe(
        'filled@example.test',
      );
      expect((await repo.findByGithubId(other.githubId))?.email).toBe('   ');
    });

    it('없는 사용자에게는 아무 일도 하지 않는다', async () => {
      await expect(
        repo.updateEmailIfEmpty(`${PREFIX}없음`, 'x@example.test'),
      ).resolves.toBeUndefined();
    });

    // 값을 SQL 문장에 이어 붙이지 않고 자리표시자로 따로 보내는지 확인한다. 이어 붙였다면 아래 값이 문장을 깬다.
    it('이메일에 따옴표와 SQL 조각이 있어도 값으로만 저장된다', async () => {
      const user = newUser({ email: null });
      await repo.create(user);
      const nasty = "x'; DROP TABLE users; --";
      await repo.updateEmailIfEmpty(user.githubId, nasty);
      expect((await repo.findByGithubId(user.githubId))?.email).toBe(nasty);
      expect(await prisma.user.count()).toBeGreaterThan(0);
    });

    it('다른 사용자가 쓰는 이메일이면 DB가 거부한다(unique)', async () => {
      const first = newUser();
      const second = newUser({ email: null });
      await repo.create(first);
      await repo.create(second);
      await expect(
        repo.updateEmailIfEmpty(second.githubId, first.email as string),
      ).rejects.toThrow();
      expect((await repo.findByGithubId(second.githubId))?.email).toBeNull();
    });
  });
});
