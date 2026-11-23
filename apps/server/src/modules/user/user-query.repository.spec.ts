import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import type { Prisma } from '../../infra/prisma/generated/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import {
  databaseReachable as reachable,
  databaseUrl as url,
} from '../../../test/support/test-database.js';
import { UserQueryRepository } from './user-query.repository.js';

// 진짜 MySQL로 하는 시험이다(docs/m5-read-api-plan.md D5). 닉네임 비교 규칙(정렬 규칙), 개수 세기, role 필터는 가짜로는 증명할 수 없다.
// 접속과 건너뛰기 판단은 test/support/test-database.ts가 한다.

// 시험이 만든 사용자의 githubId 접두사다. 다른 DB 시험의 접두사(g_test_, post_test_, intro_test_)와 겹치지 않는다.
const PREFIX = 'user_q_test_';

// 시험 데이터의 시각은 2099년이다. DB에는 이 Date의 UTC 필드가 그대로 벽시계 값으로 저장된다.
const NOW = new Date(Date.UTC(2099, 0, 1));

describe.skipIf(!reachable)('UserQueryRepository (진짜 MySQL)', () => {
  let prisma: PrismaService;
  let repo: UserQueryRepository;

  beforeAll(() => {
    prisma = new PrismaService(
      new ConfigService<EnvironmentVariables, true>({ DATABASE_URL: url }),
    );
    repo = new UserQueryRepository(prisma);
  });

  // 자식 행부터 지운다(외래 키). 복원한 실제 데이터는 접두사로 걸러서 건드리지 않는다.
  afterEach(async () => {
    const mine = { githubId: { startsWith: PREFIX } };
    const ofMine = { user: mine };
    await prisma.like.deleteMany({ where: ofMine });
    // 대댓글이 부모 댓글을 가리키는 외래 키가 있어서 대댓글부터 지운다.
    await prisma.comment.deleteMany({
      where: { ...ofMine, parentCommentId: { not: null } },
    });
    await prisma.comment.deleteMany({ where: ofMine });
    await prisma.post.deleteMany({ where: ofMine });
    await prisma.repository.deleteMany({ where: ofMine });
    await prisma.profileImage.deleteMany({ where: ofMine });
    await prisma.user.deleteMany({ where: mine });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  async function createUser(
    data: Partial<Prisma.UserUncheckedCreateInput> = {},
    profileImageUrl?: string,
  ) {
    const id = randomUUID();
    const user = await prisma.user.create({
      data: {
        githubId: `${PREFIX}${id}`,
        name: '시험 사용자',
        nickname: `${PREFIX}nick-${id}`,
        role: 'USER',
        createdAt: NOW,
        updatedAt: NOW,
        ...data,
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

  // 글은 작성자의 GitHub 저장소(사용자당 하나)가 있어야 만들 수 있다.
  async function createPost(author: { userId: bigint }) {
    const repository = await prisma.repository.upsert({
      where: { userId: author.userId },
      create: {
        name: 'test',
        userId: author.userId,
        createdAt: NOW,
        updatedAt: NOW,
      },
      update: {},
    });
    return prisma.post.create({
      data: {
        title: `제목-${randomUUID()}`,
        content: '본문',
        createdAt: NOW,
        updatedAt: NOW,
        userId: author.userId,
        repositoryId: repository.repositoryId,
      },
    });
  }

  const like = (post: { postId: bigint }, user: { userId: bigint }) =>
    prisma.like.create({
      data: {
        postId: post.postId,
        userId: user.userId,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });

  const comment = (
    post: { postId: bigint },
    user: { userId: bigint },
    parentCommentId?: bigint,
  ) =>
    prisma.comment.create({
      data: {
        content: '댓글',
        createdAt: NOW,
        updatedAt: NOW,
        postId: post.postId,
        userId: user.userId,
        parentCommentId,
      },
    });

  describe('findProfileByGithubId', () => {
    it('프로필의 모든 칸을 일반 값으로 준다', async () => {
      const user = await createUser(
        {
          email: `${randomUUID()}@example.com`,
          position: 'BACKEND',
          studentNumber: '20231234',
          gamjaBatch: 9,
          createdAt: new Date(Date.UTC(2099, 0, 1, 1, 2, 3, 456)),
          updatedAt: new Date(Date.UTC(2099, 1, 2, 4, 5, 6)),
        },
        'https://img.test/me.png',
      );
      expect(await repo.findProfileByGithubId(user.githubId)).toEqual({
        githubId: user.githubId,
        nickname: user.nickname,
        name: '시험 사용자',
        email: user.email,
        profileImageUrl: 'https://img.test/me.png',
        position: 'BACKEND',
        role: 'USER',
        studentNumber: '20231234',
        gamjaBatch: 9,
        createdAt: new Date(Date.UTC(2099, 0, 1, 1, 2, 3, 456)),
        updatedAt: new Date(Date.UTC(2099, 1, 2, 4, 5, 6)),
      });
    });

    it('가입 전 사용자의 비어 있는 칸은 null이다', async () => {
      const user = await createUser({ role: 'PRE_REGISTER' });
      expect(await repo.findProfileByGithubId(user.githubId)).toMatchObject({
        role: 'PRE_REGISTER',
        email: null,
        position: null,
        studentNumber: null,
        gamjaBatch: null,
        profileImageUrl: null,
      });
    });

    it.each(['ADMIN', 'PENDING', 'PRE_REGISTER', 'USER'] as const)(
      'role %s는 이름 문자열 그대로다',
      async (role) => {
        const user = await createUser({ role });
        expect((await repo.findProfileByGithubId(user.githubId))?.role).toBe(
          role,
        );
      },
    );

    it('없는 사용자는 null이다', async () => {
      expect(await repo.findProfileByGithubId(`${PREFIX}${randomUUID()}`)).toBe(
        null,
      );
    });
  });

  describe('findPublicProfileByNickname', () => {
    it('닉네임, 기수, 프로필 이미지와 글을 찾는 데 쓰는 githubId를 준다', async () => {
      const user = await createUser(
        { gamjaBatch: 7 },
        'https://img.test/p.png',
      );
      expect(await repo.findPublicProfileByNickname(user.nickname)).toEqual({
        githubId: user.githubId,
        nickname: user.nickname,
        gamjaBatch: 7,
        profileImageUrl: 'https://img.test/p.png',
      });
    });

    it('기수와 프로필 이미지가 없으면 null이다', async () => {
      const user = await createUser();
      expect(
        await repo.findPublicProfileByNickname(user.nickname),
      ).toMatchObject({ gamjaBatch: null, profileImageUrl: null });
    });

    it('없는 닉네임은 null이다', async () => {
      expect(
        await repo.findPublicProfileByNickname(`없는-${randomUUID()}`),
      ).toBe(null);
    });

    // 컬럼의 정렬 규칙(utf8mb4_0900_ai_ci)이 대소문자와 악센트를 구분하지 않아서, 옛 findByNickname도 그랬다.
    // 응답에는 요청 값이 아니라 저장된 닉네임이 나간다.
    it('대소문자와 악센트를 구분하지 않고, 저장된 닉네임을 돌려준다', async () => {
      const id = randomUUID();
      const stored = `${PREFIX}Café-${id}`;
      await createUser({ nickname: stored });
      const found = await repo.findPublicProfileByNickname(
        `${PREFIX}CAFE-${id}`,
      );
      expect(found?.nickname).toBe(stored);
    });

    it('한글 닉네임을 찾는다', async () => {
      const stored = `${PREFIX}감자-${randomUUID()}`;
      await createUser({ nickname: stored });
      expect((await repo.findPublicProfileByNickname(stored))?.nickname).toBe(
        stored,
      );
    });

    // utf8mb4_0900_ai_ci는 NO PAD라서 끝의 공백도 값이다. 옛 서버와 같은 DB 규칙이다.
    it('끝에 공백이 붙은 닉네임은 다른 값이다', async () => {
      const user = await createUser();
      expect(await repo.findPublicProfileByNickname(`${user.nickname} `)).toBe(
        null,
      );
    });
  });

  describe('countActivity', () => {
    it('좋아요 행, 쓴 글, 쓴 댓글(대댓글 포함)을 센다', async () => {
      const me = await createUser();
      const other = await createUser();
      const mine1 = await createPost(me);
      const mine2 = await createPost(me);
      const theirs = await createPost(other);
      // 같은 글에 두 번 누른 행도 행마다 센다(옛 countByUser와 같다).
      await like(theirs, me);
      await like(theirs, me);
      await like(mine1, me);
      await like(mine1, other); // 남의 좋아요는 세지 않는다
      const parent = await comment(theirs, me);
      await comment(theirs, me, parent.commentId); // 대댓글도 댓글이다
      await comment(mine2, me);
      await comment(mine2, other); // 남의 댓글은 세지 않는다

      expect(await repo.countActivity(me.githubId)).toEqual({
        likedPostCount: 3,
        writtenPostCount: 2,
        writtenCommentCount: 3,
      });
      expect(await repo.countActivity(other.githubId)).toEqual({
        likedPostCount: 1,
        writtenPostCount: 1,
        writtenCommentCount: 1,
      });
    });

    it('활동이 없거나 없는 사용자는 모두 0이다', async () => {
      const me = await createUser();
      const zero = {
        likedPostCount: 0,
        writtenPostCount: 0,
        writtenCommentCount: 0,
      };
      expect(await repo.countActivity(me.githubId)).toEqual(zero);
      expect(await repo.countActivity(`${PREFIX}${randomUUID()}`)).toEqual(
        zero,
      );
    });
  });

  describe('findPendingUsers', () => {
    it('role이 PENDING인 사용자만, userId 오름차순으로 준다', async () => {
      const a = await createUser({
        role: 'PENDING',
        name: '가',
        gamjaBatch: 9,
        position: 'FRONTEND',
      });
      await createUser({ role: 'USER' });
      await createUser({ role: 'PRE_REGISTER' });
      await createUser({ role: 'ADMIN' });
      const b = await createUser({ role: 'PENDING', name: '나' });

      // 복원한 실제 데이터에 대기 중인 사용자가 생길 수 있어서 시험 사용자만 고른다.
      const ids = new Set([Number(a.userId), Number(b.userId)]);
      const pending = (await repo.findPendingUsers()).filter((user) =>
        ids.has(user.userId),
      );
      expect(pending).toEqual([
        {
          userId: Number(a.userId),
          gamjaBatch: 9,
          name: '가',
          position: 'FRONTEND',
        },
        {
          userId: Number(b.userId),
          gamjaBatch: null,
          name: '나',
          position: null,
        },
      ]);
    });

    it('시험 사용자 중 PENDING이 아닌 사람은 목록에 없다', async () => {
      const user = await createUser({ role: 'USER' });
      const pending = await repo.findPendingUsers();
      expect(pending.map((p) => p.userId)).not.toContain(Number(user.userId));
    });
  });
});
