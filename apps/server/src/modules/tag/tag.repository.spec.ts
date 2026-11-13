import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import {
  databaseReachable as reachable,
  databaseUrl as url,
} from '../../../test/support/test-database.js';
import { TagRepository } from './tag.repository.js';

// 진짜 MySQL로 하는 시험이다. 태그 이름의 정렬은 DB의 정렬 규칙(utf8mb4_0900_ai_ci)이 정하므로 가짜로는 증명할 수 없다.
// 접두사는 post.repository.spec.ts의 test-tag-와 겹치지 않게 했다. 파일은 병렬로 돌고, 저쪽 afterEach가 그 접두사의 태그를 지운다.
const PREFIX = 'tag-spec-';
const NOW = new Date(Date.UTC(2099, 0, 1));

describe.skipIf(!reachable)('TagRepository (진짜 MySQL)', () => {
  let prisma: PrismaService;
  let repo: TagRepository;

  beforeAll(() => {
    prisma = new PrismaService(
      new ConfigService<EnvironmentVariables, true>({ DATABASE_URL: url }),
    );
    repo = new TagRepository(prisma);
  });

  afterEach(async () => {
    await prisma.tag.deleteMany({ where: { tagName: { startsWith: PREFIX } } });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  const createTags = (names: string[]) =>
    prisma.tag.createMany({
      data: names.map((tagName) => ({
        tagName,
        createdAt: NOW,
        updatedAt: NOW,
      })),
    });

  // 복원한 실제 태그가 함께 나오므로 전체 목록은 비교하지 않고, 이 시험이 만든 태그만 걸러서 순서를 본다.
  const mine = async (own: string) =>
    (await repo.findAllTagNames()).filter((name) => name.startsWith(own));

  it('이름 오름차순이고 대소문자를 구분하지 않는다(JS 정렬과 다르다)', async () => {
    const own = `${PREFIX}${randomUUID()}-`;
    // 만든 순서와 다르게 넣는다. JS의 기본 정렬은 대문자가 먼저라 B, a, c가 되지만 DB는 a, B, c다.
    await createTags([`${own}c`, `${own}B`, `${own}a`]);

    const names = await mine(own);
    expect(names).toEqual([`${own}a`, `${own}B`, `${own}c`]);
    expect(names).not.toEqual([...names].sort());
  });

  it('글에 연결되지 않은 태그도 나온다', async () => {
    const own = `${PREFIX}${randomUUID()}-`;
    await createTags([`${own}고아`]);
    expect(await mine(own)).toEqual([`${own}고아`]);
  });

  it('한글은 가나다순이다', async () => {
    const own = `${PREFIX}${randomUUID()}-`;
    await createTags([`${own}프론트`, `${own}백엔드`, `${own}데이터`]);
    expect(await mine(own)).toEqual([
      `${own}데이터`,
      `${own}백엔드`,
      `${own}프론트`,
    ]);
  });
});
