import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { kstWallClockNow } from '../../common/local-date-time.js';
import type { Prisma } from '../../infra/prisma/generated/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import {
  databaseReachable as reachable,
  databaseUrl as url,
} from '../../../test/support/test-database.js';
import type { ProfileFields } from './dto/profile-request.js';
import { UserWriteRepository } from './user-write.repository.js';

// 진짜 MySQL로 하는 시험이다. 이메일 유일 제약(중복 → 롤백), updated_at 채우기, 학번 비교는 가짜로는 증명할 수 없다.
// 시험이 만든 사용자의 githubId 접두사다. 이메일과 학번에도 붙여서 복원한 실제 회원의 값과 겹칠 수 없게 한다.
const PREFIX = 'user_w_test_';

// 시험 사용자의 시각은 옛날이다. 쓰기가 채우는 updated_at(지금)과 구분하려는 것이다.
const OLD = new Date(Date.UTC(2020, 0, 1));

const FIELDS: ProfileFields = {
  email: `${PREFIX}new@example.test`,
  studentNumber: `${PREFIX}s-new`,
  gamjaBatch: 9,
  position: 'BACKEND',
};

describe.skipIf(!reachable)('UserWriteRepository (진짜 MySQL)', () => {
  let prisma: PrismaService;
  let repo: UserWriteRepository;

  beforeAll(() => {
    prisma = new PrismaService(
      new ConfigService<EnvironmentVariables, true>({ DATABASE_URL: url }),
    );
    repo = new UserWriteRepository(prisma);
  });

  afterEach(async () => {
    const mine = { githubId: { startsWith: PREFIX } };
    await prisma.profileImage.deleteMany({ where: { user: mine } });
    await prisma.user.deleteMany({ where: mine });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  async function createUser(
    data: Partial<Prisma.UserUncheckedCreateInput> = {},
  ) {
    const id = randomUUID();
    return prisma.user.create({
      data: {
        githubId: `${PREFIX}${id}`,
        name: '시험 사용자',
        nickname: `${PREFIX}nick-${id}`,
        email: `${PREFIX}${id}@example.test`,
        role: 'PRE_REGISTER',
        createdAt: OLD,
        updatedAt: OLD,
        ...data,
      },
    });
  }

  const reload = (githubId: string) =>
    prisma.user.findUniqueOrThrow({ where: { githubId } });

  // "방금"이다: 시험이 도는 동안(몇 초) 안에 쓴 시각인지 본다. kstWallClockNow는 서울 벽시계 값이다.
  const isJustNow = (written: Date) =>
    Math.abs(written.getTime() - kstWallClockNow().getTime()) < 60_000;

  describe('existsByStudentNumber', () => {
    it('같은 학번이 있으면 true, 없으면 false다', async () => {
      await createUser({ studentNumber: `${PREFIX}s-1` });
      expect(await repo.existsByStudentNumber(`${PREFIX}s-1`)).toBe(true);
      expect(await repo.existsByStudentNumber(`${PREFIX}s-2`)).toBe(false);
    });
  });

  describe('completeProfile', () => {
    it('네 칸을 덮어쓰고 role을 PENDING으로 바꾸고 updated_at을 채운다', async () => {
      const user = await createUser();
      const result = await repo.completeProfile(user.githubId, FIELDS);

      expect(result.status).toBe('UPDATED');
      const saved = await reload(user.githubId);
      expect(saved).toMatchObject({
        email: FIELDS.email,
        studentNumber: FIELDS.studentNumber,
        gamjaBatch: 9,
        position: 'BACKEND',
        role: 'PENDING',
      });
      expect(saved.createdAt).toEqual(OLD);
      expect(isJustNow(saved.updatedAt)).toBe(true);
    });

    it('응답은 새 값과 수정 전 updatedAt이다 [추정: 옛 JPA는 flush 전에 응답을 만들었다]', async () => {
      const user = await createUser({ nickname: `${PREFIX}nick-fixed` });
      const result = await repo.completeProfile(user.githubId, FIELDS);
      if (result.status !== 'UPDATED') expect.unreachable();

      expect(result.profile).toEqual({
        githubId: user.githubId,
        nickname: `${PREFIX}nick-fixed`,
        name: '시험 사용자',
        email: FIELDS.email,
        profileImageUrl: null,
        position: 'BACKEND',
        role: 'PENDING',
        studentNumber: FIELDS.studentNumber,
        gamjaBatch: 9,
        createdAt: OLD,
        updatedAt: OLD,
      });
    });

    it('이메일이 없으면 있던 이메일도 비운다(옛 MapStruct 기본 동작)', async () => {
      const user = await createUser();
      const result = await repo.completeProfile(user.githubId, {
        ...FIELDS,
        email: null,
      });

      expect(result.status).toBe('UPDATED');
      expect((await reload(user.githubId)).email).toBeNull();
    });

    it('프로필 이미지가 있으면 그 주소를 싣는다', async () => {
      const user = await createUser();
      await prisma.profileImage.create({
        data: {
          profileImageUrl: 'https://example.test/me.png',
          userId: user.userId,
          createdAt: OLD,
          updatedAt: OLD,
        },
      });
      const result = await repo.completeProfile(user.githubId, FIELDS);
      if (result.status !== 'UPDATED') expect.unreachable();

      expect(result.profile.profileImageUrl).toBe(
        'https://example.test/me.png',
      );
    });

    it('사용자가 없으면 USER_NOT_FOUND다', async () => {
      expect(await repo.completeProfile(`${PREFIX}none`, FIELDS)).toEqual({
        status: 'USER_NOT_FOUND',
      });
    });

    it('이메일이 다른 사용자와 겹치면 유일 제약에 걸려 실패하고 아무것도 바뀌지 않는다', async () => {
      const taken = await createUser();
      const user = await createUser();

      await expect(
        repo.completeProfile(user.githubId, { ...FIELDS, email: taken.email }),
      ).rejects.toMatchObject({ code: 'P2002' });

      expect(await reload(user.githubId)).toMatchObject({
        role: 'PRE_REGISTER',
        email: user.email,
        studentNumber: null,
      });
    });
  });

  describe('updateProfile', () => {
    it('네 칸을 덮어쓰되 role은 그대로 두고 updated_at을 채운다', async () => {
      const user = await createUser({
        role: 'ADMIN',
        studentNumber: `${PREFIX}s-old`,
        gamjaBatch: 1,
        position: 'DESIGNER',
      });
      const result = await repo.updateProfile(user.githubId, FIELDS);

      expect(result.status).toBe('UPDATED');
      const saved = await reload(user.githubId);
      expect(saved).toMatchObject({
        email: FIELDS.email,
        studentNumber: FIELDS.studentNumber,
        gamjaBatch: 9,
        position: 'BACKEND',
        role: 'ADMIN',
      });
      expect(isJustNow(saved.updatedAt)).toBe(true);
    });

    it('응답은 새 값과 수정 전 updatedAt이다', async () => {
      const user = await createUser({ role: 'USER' });
      const result = await repo.updateProfile(user.githubId, FIELDS);
      if (result.status !== 'UPDATED') expect.unreachable();

      expect(result.profile).toMatchObject({
        email: FIELDS.email,
        role: 'USER',
        updatedAt: OLD,
      });
    });

    it('학번이 다른 사용자와 같아도 막지 않는다(옛 코드는 수정에서 학번 중복을 검사하지 않는다)', async () => {
      await createUser({ studentNumber: FIELDS.studentNumber });
      const user = await createUser({ role: 'USER' });

      expect((await repo.updateProfile(user.githubId, FIELDS)).status).toBe(
        'UPDATED',
      );
    });

    it('사용자가 없으면 USER_NOT_FOUND이고, 이메일이 겹치면 실패한다', async () => {
      expect(await repo.updateProfile(`${PREFIX}none`, FIELDS)).toEqual({
        status: 'USER_NOT_FOUND',
      });
      const taken = await createUser();
      const user = await createUser({ role: 'USER' });
      await expect(
        repo.updateProfile(user.githubId, { ...FIELDS, email: taken.email }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  describe('approve', () => {
    it('PENDING이면 USER로 바꾸고 updated_at을 채운다', async () => {
      const user = await createUser({ role: 'PENDING' });

      expect(await repo.approve(user.userId)).toEqual({ status: 'APPROVED' });

      const saved = await reload(user.githubId);
      expect(saved.role).toBe('USER');
      expect(isJustNow(saved.updatedAt)).toBe(true);
    });

    it.each(['USER', 'ADMIN', 'PRE_REGISTER'] as const)(
      'PENDING이 아니면(%s) 바꾸지 않는다',
      async (role) => {
        const user = await createUser({ role });

        expect(await repo.approve(user.userId)).toEqual({
          status: 'NOT_PENDING',
        });

        expect(await reload(user.githubId)).toMatchObject({
          role,
          updatedAt: OLD,
        });
      },
    );

    it('없는 사용자는 USER_NOT_FOUND다', async () => {
      expect(await repo.approve(999_999_999_999n)).toEqual({
        status: 'USER_NOT_FOUND',
      });
    });
  });
});
