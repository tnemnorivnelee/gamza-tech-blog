import { readFileSync } from 'node:fs';
import { Controller, Get, Post } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ApiExcludeController } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { Public, Roles } from '../../src/modules/auth/access.decorator.js';
import type { Contract } from '../contract/diff-contract.js';
import { findAccessMismatches } from './find-access-mismatches.js';
import { ALWAYS_DENIED_IN_OLD, oldAccessRules } from './old-access-rules.js';

const contract = JSON.parse(
  readFileSync(
    new URL('../../contract/front-contract.json', import.meta.url),
    'utf8',
  ),
) as Contract;

const kindOf = (name: string) => {
  const access = oldAccessRules[name];
  if (access === 'public') return 'public';
  const roles = [...access].sort().join('|');
  if (roles === 'ADMIN|USER') return 'login';
  if (roles === 'ADMIN') return 'admin';
  return 'special';
};

describe('접근 규칙 표', () => {
  it('표의 작업은 프론트 계약의 작업과 정확히 같다(빠지거나 남는 것이 없다)', () => {
    const inContract = contract.operations.map((op) => op.operationId).sort();
    expect(Object.keys(oldAccessRules).sort()).toEqual(inContract);
    expect(inContract).toHaveLength(48);
  });

  it('분류 개수는 계획서와 같다: 공개 13, 로그인 27, ADMIN 6, 특수 2', () => {
    const counts: Record<string, number> = {};
    for (const name of Object.keys(oldAccessRules)) {
      counts[kindOf(name)] = (counts[kindOf(name)] ?? 0) + 1;
    }
    expect(counts).toEqual({ public: 13, login: 27, admin: 6, special: 2 });
  });

  it('옛 서버에서 항상 거부된 작업은 로그인 분류에 있다', () => {
    expect(ALWAYS_DENIED_IN_OLD).toEqual(['getCommitHistories']);
    for (const name of ALWAYS_DENIED_IN_OLD) expect(kindOf(name)).toBe('login');
  });

  // 경로 규칙을 메서드 이름으로 옮기다 틀리기 쉬운 곳을 따로 고정한다.
  it.each([
    ['reissue', 'public'], // 토큰 재발급은 토큰 없이 부른다
    ['logout', 'login'],
    ['getMyPosts', 'login'], // GET /posts/me는 GET /posts/* 공개 규칙의 예외다
    ['getPostDetail', 'public'],
    ['getComments', 'login'], // 댓글 조회는 공개가 아니다
    ['chat', 'public'], // POST인데도 공개다
    ['lookup', 'public'],
    ['getAll', 'admin'],
    ['completeProfile', 'special'],
    ['getCurrentUserRole', 'special'],
  ])('%s는 %s다', (name, kind) => {
    expect(kindOf(name)).toBe(kind);
  });
});

describe('등록된 라우트와 표 비교', () => {
  // 컨트롤러를 옮길 때마다 이 시험의 범위가 저절로 넓어진다. 지금은 등록된 컨트롤러가 없어서 빈 목록이다.
  it('지금 앱에 등록된 라우트는 모두 표와 같은 접근 규칙이다', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    }).compile();
    expect(findAccessMismatches(moduleRef, oldAccessRules)).toEqual([]);
    await moduleRef.close();
  });

  // 위 시험이 빈 앱에서 항상 통과하지 않는지, 비교 함수가 틀린 것을 잡는지 확인한다.
  describe('비교 함수가 틀린 것을 잡는다', () => {
    @Controller('fx')
    class FixtureController {
      @Public()
      @Post('chat')
      chat() {} // 표: public → 맞음

      @Get('tags')
      getAllTags() {} // 표: public인데 꼬리표가 없음 → 어긋남

      @Roles('PRE_REGISTER')
      @Post('complete')
      completeProfile() {} // 표: PRE_REGISTER → 맞음

      @Roles('ADMIN')
      @Get('role')
      getCurrentUserRole() {} // 표: 네 role 모두인데 ADMIN만 → 어긋남

      @Get('extra')
      notInTable() {} // 표에 없음

      helper() {} // 라우트가 아니라서 무시한다
    }

    // 로그인 경로(GithubLoginController)는 프론트 계약에 없고 @ApiExcludeController로 명세에서도 뺀다. 표 비교에서도 뺀다.
    @ApiExcludeController()
    @Controller('hidden')
    class HiddenController {
      @Get('login')
      startLogin() {} // 표에 없지만 명세에서 뺀 컨트롤러라서 어긋남으로 세지 않는다
    }

    it('명세에서 뺀 컨트롤러는 표 비교에서 빠진다', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [DiscoveryModule],
        controllers: [HiddenController],
      }).compile();

      expect(findAccessMismatches(moduleRef, oldAccessRules)).toEqual([]);
      await moduleRef.close();
    });

    it('어긋난 규칙과 표에 없는 라우트를 모두 알려 준다', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [DiscoveryModule],
        controllers: [FixtureController],
      }).compile();

      expect(findAccessMismatches(moduleRef, oldAccessRules)).toEqual([
        'FixtureController.getAllTags: 표는 public인데 코드는 ADMIN|USER',
        'FixtureController.getCurrentUserRole: 표는 ADMIN|PENDING|PRE_REGISTER|USER인데 코드는 ADMIN',
        'FixtureController.notInTable: 접근 규칙 표에 없다',
      ]);
      await moduleRef.close();
    });
  });
});
