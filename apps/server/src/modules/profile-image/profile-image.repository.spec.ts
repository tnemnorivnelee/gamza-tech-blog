import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { kstWallClockNow } from '../../common/local-date-time.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import {
  databaseReachable as reachable,
  databaseUrl as url,
} from '../../../test/support/test-database.js';
import { ProfileImageRepository } from './profile-image.repository.js';

// 진짜 MySQL로 하는 시험이다. 행 교체가 한 트랜잭션인지(실패하면 옛 행이 남는지)는 가짜로는 증명할 수 없다.
// 시험이 만든 사용자의 githubId 접두사다. 다른 DB 시험의 접두사와 겹치지 않는다.
const PREFIX = 'profile_img_test_';

// 시험 사용자의 시각은 옛날이다. 쓰기가 채우는 시각(지금)과 구분하려는 것이다.
const OLD = new Date(Date.UTC(2020, 0, 1));

describe.skipIf(!reachable)('ProfileImageRepository (진짜 MySQL)', () => {
  let prisma: PrismaService;
  let repo: ProfileImageRepository;

  beforeAll(() => {
    prisma = new PrismaService(
      new ConfigService<EnvironmentVariables, true>({ DATABASE_URL: url }),
    );
    repo = new ProfileImageRepository(prisma);
  });

  afterEach(async () => {
    const mine = { githubId: { startsWith: PREFIX } };
    await prisma.profileImage.deleteMany({ where: { user: mine } });
    await prisma.user.deleteMany({ where: mine });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  async function createUser(imageUrl?: string) {
    const id = randomUUID();
    const user = await prisma.user.create({
      data: {
        githubId: `${PREFIX}${id}`,
        name: '시험 사용자',
        nickname: `${PREFIX}nick-${id}`,
        role: 'USER',
        createdAt: OLD,
        updatedAt: OLD,
      },
    });
    if (imageUrl)
      await prisma.profileImage.create({
        data: {
          profileImageUrl: imageUrl,
          userId: user.userId,
          createdAt: OLD,
          updatedAt: OLD,
        },
      });
    return user;
  }

  const imagesOf = (userId: bigint) =>
    prisma.profileImage.findMany({ where: { userId } });

  describe('findUserWithImage', () => {
    it('이미지가 있으면 주소를, 없으면 null을 준다', async () => {
      const withImage = await createUser('https://img.test/a.png');
      const without = await createUser();

      expect(await repo.findUserWithImage(withImage.githubId)).toEqual({
        userId: withImage.userId,
        imageUrl: 'https://img.test/a.png',
      });
      expect(await repo.findUserWithImage(without.githubId)).toEqual({
        userId: without.userId,
        imageUrl: null,
      });
    });

    it('사용자가 없으면 null이다', async () => {
      expect(await repo.findUserWithImage(`${PREFIX}none`)).toBeNull();
    });
  });

  describe('replaceImage', () => {
    it('이미지가 없던 사용자에게 새 행을 넣는다', async () => {
      const user = await createUser();
      const saved = await repo.replaceImage(
        user.userId,
        'https://img.test/new.png',
      );

      const rows = await imagesOf(user.userId);
      expect(rows).toHaveLength(1);
      expect(saved).toEqual({
        id: rows[0].profileImageId,
        imageUrl: 'https://img.test/new.png',
      });
      // 시각은 서울 벽시계의 지금이다(1분 안).
      expect(
        Math.abs(rows[0].createdAt.getTime() - kstWallClockNow().getTime()),
      ).toBeLessThan(60_000);
      expect(rows[0].updatedAt).toEqual(rows[0].createdAt);
    });

    it('있던 행은 지우고 새 행 하나만 남긴다(다른 사용자의 행은 그대로)', async () => {
      const user = await createUser('https://img.test/old.png');
      const other = await createUser('https://img.test/other.png');
      const before = (await imagesOf(user.userId))[0];

      const saved = await repo.replaceImage(
        user.userId,
        'https://img.test/new.png',
      );

      const rows = await imagesOf(user.userId);
      expect(rows.map((r) => r.profileImageUrl)).toEqual([
        'https://img.test/new.png',
      ]);
      expect(saved.id).not.toBe(before.profileImageId);
      expect(
        (await imagesOf(other.userId)).map((r) => r.profileImageUrl),
      ).toEqual(['https://img.test/other.png']);
    });

    it('users 행은 바꾸지 않는다', async () => {
      const user = await createUser('https://img.test/old.png');
      await repo.replaceImage(user.userId, 'https://img.test/new.png');

      expect(
        (
          await prisma.user.findUniqueOrThrow({
            where: { userId: user.userId },
          })
        ).updatedAt,
      ).toEqual(OLD);
    });

    it('새 행을 넣다 실패하면 지운 옛 행도 되돌아온다', async () => {
      const user = await createUser('https://img.test/old.png');
      // 주소 칸은 2048자까지다. 넘으면 넣기가 실패한다.
      const tooLong = `https://img.test/${'a'.repeat(2048)}.png`;

      await expect(repo.replaceImage(user.userId, tooLong)).rejects.toThrow();

      expect(
        (await imagesOf(user.userId)).map((r) => r.profileImageUrl),
      ).toEqual(['https://img.test/old.png']);
    });
  });

  describe('deleteImages', () => {
    it('그 사용자의 행만 지운다', async () => {
      const user = await createUser('https://img.test/a.png');
      const other = await createUser('https://img.test/b.png');

      await repo.deleteImages(user.userId);

      expect(await imagesOf(user.userId)).toHaveLength(0);
      expect(await imagesOf(other.userId)).toHaveLength(1);
    });

    it('행이 없어도 오류가 아니다', async () => {
      const user = await createUser();
      await expect(repo.deleteImages(user.userId)).resolves.toBeUndefined();
    });
  });
});
