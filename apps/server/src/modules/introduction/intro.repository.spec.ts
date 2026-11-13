import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../common/error/error-code.js';
import type { SortOrder } from '../../common/pageable.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import {
  databaseReachable as reachable,
  databaseUrl as url,
} from '../../../test/support/test-database.js';
import { IntroRepository } from './intro.repository.js';

// 진짜 MySQL로 하는 시험이다(docs/m5-read-api-plan.md D5). 정렬, 쪽 나누기, 개수는 가짜로는 증명할 수 없다.
// 접속과 건너뛰기 판단은 test/support/test-database.ts가 한다.

// 시험이 만든 사용자의 githubId 접두사다. 다른 DB 시험의 접두사(g_test_, post_test_, user_q_test_)와 겹치지 않는다.
const PREFIX = 'intro_test_';

// 시험 소개의 작성 시각은 2099년이다. 복원한 실제 소개(2026년까지)보다 늦어서 기본 정렬에서는 맨 앞에 온다.
const at = (seconds: number) => new Date(Date.UTC(2099, 0, 1, 0, 0, seconds));
const NOW = new Date(Date.UTC(2099, 0, 1));
const first = (page = 0, size = 10) => ({ page, size });
const DEFAULT: SortOrder[] = [{ property: 'createdAt', direction: 'desc' }];
const order = (property: string, direction: 'asc' | 'desc'): SortOrder => ({
  property,
  direction,
});

describe.skipIf(!reachable)('IntroRepository (진짜 MySQL)', () => {
  let prisma: PrismaService;
  let repo: IntroRepository;

  beforeAll(() => {
    prisma = new PrismaService(
      new ConfigService<EnvironmentVariables, true>({ DATABASE_URL: url }),
    );
    repo = new IntroRepository(prisma);
  });

  // 자식 행부터 지운다(외래 키). 복원한 실제 데이터는 접두사로 걸러서 건드리지 않는다.
  afterEach(async () => {
    const mine = { githubId: { startsWith: PREFIX } };
    await prisma.introduction.deleteMany({ where: { user: mine } });
    await prisma.profileImage.deleteMany({ where: { user: mine } });
    await prisma.user.deleteMany({ where: mine });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  async function createUser(profileImageUrl?: string) {
    const id = randomUUID();
    const user = await prisma.user.create({
      data: {
        githubId: `${PREFIX}${id}`,
        name: '시험 사용자',
        nickname: `${PREFIX}nick-${id}`,
        role: 'USER',
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    if (profileImageUrl)
      await prisma.profileImage.create({
        data: {
          profileImageUrl,
          userId: user.userId,
          createdAt: NOW,
          updatedAt: NOW,
        },
      });
    return user;
  }

  // 소개는 사용자마다 하나(unique)다. updatedAt은 따로 주지 않으면 createdAt과 같다.
  const introFor = (
    user: { userId: bigint },
    content: string,
    createdAt: Date,
    updatedAt = createdAt,
  ) =>
    prisma.introduction.create({
      data: { content, createdAt, updatedAt, userId: user.userId },
    });

  async function createIntro(
    content: string,
    createdAt: Date,
    profileImageUrl?: string,
    updatedAt?: Date,
  ) {
    const user = await createUser(profileImageUrl);
    return { user, intro: await introFor(user, content, createdAt, updatedAt) };
  }

  // 복원한 실제 소개가 함께 오므로 시험 소개만 골라 내용 순서를 본다.
  const mine = (page: { intros: { nickname: string; content: string }[] }) =>
    page.intros
      .filter((intro) => intro.nickname.startsWith(PREFIX))
      .map((intro) => intro.content);

  // size 2000(상한)이면 복원 데이터를 포함한 전부가 한 쪽에 들어온다.
  const everything = (orders: SortOrder[]) =>
    repo.findIntroPage(first(0, 2000), orders);

  // 네 소개: a(1초), b(3초), c(2초), d(3초, b와 같은 시각이고 나중에 만들어 introId가 크다).
  async function createFour() {
    await createIntro('a', at(1));
    await createIntro('b', at(3));
    await createIntro('c', at(2));
    await createIntro('d', at(3));
  }

  describe('정렬', () => {
    it('기본은 작성 시각 내림차순이고, 같은 시각이면 introId가 큰 쪽이 먼저다', async () => {
      await createFour();
      expect(mine(await everything(DEFAULT))).toEqual(['d', 'b', 'c', 'a']);
    });

    it('기본 정렬에서는 시험 소개가 맨 앞이다(복원한 실제 소개보다 늦다)', async () => {
      await createFour();
      const page = await repo.findIntroPage(first(0, 4), DEFAULT);
      expect(mine(page)).toEqual(['d', 'b', 'c', 'a']);
      expect(page.intros).toHaveLength(4);
    });

    // 같은 시각의 마무리는 방향과 상관없이 introId 내림차순이다(옛 서버는 정하지 않았다).
    it('createdAt 오름차순이면 오래된 것부터이고, 같은 시각은 introId가 큰 쪽이 먼저다', async () => {
      await createFour();
      expect(mine(await everything([order('createdAt', 'asc')]))).toEqual([
        'a',
        'c',
        'd',
        'b',
      ]);
    });

    it('id(introId 컬럼) 오름차순과 내림차순', async () => {
      await createFour();
      expect(mine(await everything([order('id', 'asc')]))).toEqual([
        'a',
        'b',
        'c',
        'd',
      ]);
      expect(mine(await everything([order('id', 'desc')]))).toEqual([
        'd',
        'c',
        'b',
        'a',
      ]);
    });

    // id는 introId 컬럼이다. 소개 번호의 순서가 사용자 번호의 순서와 다르게 만들어서 둘을 헷갈리지 않는지 본다.
    it('id 정렬은 소개 번호 기준이다(사용자 번호가 아니다)', async () => {
      const firstUser = await createUser();
      const secondUser = await createUser();
      await introFor(secondUser, 'p', at(1)); // 소개 번호는 작고 사용자 번호는 크다
      await introFor(firstUser, 'q', at(2));
      expect(mine(await everything([order('id', 'asc')]))).toEqual(['p', 'q']);
    });

    // createdAt과 updatedAt이 서로 다른 값이어야 어느 쪽으로 정렬했는지 드러난다.
    it('createdAt과 updatedAt은 각자의 컬럼으로 정렬한다', async () => {
      await createIntro('a', at(1), undefined, at(9));
      await createIntro('b', at(2), undefined, at(3));
      expect(mine(await everything([order('createdAt', 'asc')]))).toEqual([
        'a',
        'b',
      ]);
      expect(mine(await everything([order('updatedAt', 'asc')]))).toEqual([
        'b',
        'a',
      ]);
    });

    it('content로 정렬하고, 여러 항목은 앞에서부터 적용한다', async () => {
      await createIntro('x', at(5));
      await createIntro('x', at(7));
      await createIntro('y', at(6));
      const page = await everything([
        order('content', 'desc'),
        order('createdAt', 'asc'),
      ]);
      expect(
        page.intros
          .filter((intro) => intro.nickname.startsWith(PREFIX))
          .map((intro) => [intro.content, intro.createdAt]),
      ).toEqual([
        ['y', at(6)],
        ['x', at(5)],
        ['x', at(7)],
      ]);
      expect(mine(await everything([order('content', 'asc')]))).toEqual([
        'x',
        'x',
        'y',
      ]);
    });

    // 옛 Spring Data는 엔티티에 없는 속성으로 정렬하면 예외를 던졌고 처리기가 500으로 보냈다.
    // 응답 이름(introId)과 연관(user)도 엔티티 필드 이름이 아니라서 허용 목록에 없다.
    it.each([
      'introId',
      'user',
      'nope',
      'constructor',
      '__proto__',
      'toString',
    ])('허용 목록에 없는 속성(%s)은 500 C004다', async (property) => {
      await expect(
        repo.findIntroPage(first(), [order(property, 'asc')]),
      ).rejects.toMatchObject({ errorCode: ErrorCode.INTERNAL_SERVER_ERROR });
    });
  });

  describe('쪽 나누기와 개수', () => {
    it('쪽마다 size개씩 이어서 준다', async () => {
      await createFour();
      expect(mine(await repo.findIntroPage(first(0, 2), DEFAULT))).toEqual([
        'd',
        'b',
      ]);
      expect(mine(await repo.findIntroPage(first(1, 2), DEFAULT))).toEqual([
        'c',
        'a',
      ]);
    });

    it('totalElements는 복원한 실제 소개를 포함한 전체 개수다', async () => {
      await createFour();
      const page = await repo.findIntroPage(first(0, 1), DEFAULT);
      expect(page.totalElements).toBe(await prisma.introduction.count());
      expect(page.totalElements).toBeGreaterThanOrEqual(4);
    });

    // 글 목록은 범위를 넘기면 개수를 0으로 주지만, 소개 목록은 옛 Spring Data의 Page라서 실제 개수를 센다.
    it('범위를 넘긴 쪽은 내용이 비어도 전체 개수를 센다', async () => {
      await createFour();
      const page = await repo.findIntroPage(first(2147483647, 2000), DEFAULT);
      expect(page.intros).toEqual([]);
      expect(page.totalElements).toBe(await prisma.introduction.count());
      expect(page.totalElements).toBeGreaterThanOrEqual(4);
    });
  });

  describe('한 줄의 값', () => {
    it('소개와 작성자의 값을 일반 값으로 준다', async () => {
      const { user, intro } = await createIntro(
        '안녕하세요 ![x](y) 반갑습니다',
        at(9),
        'https://img.test/intro.png',
      );
      const page = await repo.findIntroPage(first(0, 1), DEFAULT);
      expect(page.intros[0]).toEqual({
        introId: Number(intro.introId),
        userId: Number(user.userId),
        nickname: user.nickname,
        profileImageUrl: 'https://img.test/intro.png',
        // 소개는 본문을 있는 그대로 준다(글 목록처럼 이미지 표기를 지우지 않는다).
        content: '안녕하세요 ![x](y) 반갑습니다',
        createdAt: at(9),
      });
    });

    it('프로필 이미지가 없으면 null이다', async () => {
      await createIntro('이미지 없음', at(9));
      const page = await repo.findIntroPage(first(0, 1), DEFAULT);
      expect(page.intros[0].profileImageUrl).toBeNull();
    });

    it('한글과 이모지 본문이 깨지지 않는다', async () => {
      await createIntro('감자 🥔 반가워요', at(9));
      const page = await repo.findIntroPage(first(0, 1), DEFAULT);
      expect(page.intros[0].content).toBe('감자 🥔 반가워요');
    });
  });
});
