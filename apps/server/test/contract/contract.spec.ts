import { readFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import type {
  OpenAPIObject,
  ResponseObject,
  SchemaObject,
} from '@nestjs/swagger';
import { type Contract, diffContract } from './diff-contract.js';
import { createFakeApp } from './fakes.js';

const contract = JSON.parse(
  readFileSync(
    new URL('../../contract/front-contract.json', import.meta.url),
    'utf8',
  ),
) as Contract;

// 시험 단계에서는 가짜 컨트롤러가 흉내 내는 작업과 실제로 옮긴 작업(reissue, logout, 글 목록 4개, 글 상세·인기·홈 피드·태그)만 비교한다.
// 실제 컨트롤러가 늘면 이 목록을 없애고 계약 전체와 비교한다.
// 합격 기준: 비교 결과가 빈 목록이어야 한다. 데코레이터로 표현이 안 되면 생성된 문서를 후처리해도 되지만
// 판정은 이 비교가 한다.
const TRIAL = {
  operations: [
    'addComment',
    'deleteComment',
    'getMyComments',
    'delete',
    'reissue',
    'logout',
    'getPosts',
    'getPostsByTag',
    'searchPosts',
    'getMyPosts',
    'getPostDetail',
    'getWeeklyPopularPosts',
    'getHomeFeed',
    'getAllTags',
  ],
  models: ['Pageable'],
};

const addCommentResponse = (doc: OpenAPIObject) => {
  const response = doc.paths['/api/v1/comment/{postId}/comments'].post!
    .responses['200'] as ResponseObject;
  return response.content!['application/json'].schema as SchemaObject;
};

describe('OpenAPI 계약', () => {
  let app: INestApplication;
  let baseUrl: string;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    app = await createFakeApp();
    baseUrl = await app.getUrl();
    doc = (await (
      await fetch(`${baseUrl}/v3/api-docs/all`)
    ).json()) as OpenAPIObject;
  });

  afterAll(() => app.close());

  it('명세는 OpenAPI 3.0.x이고 /v3/api-docs/all에서 나온다', () => {
    expect(doc.openapi).toMatch(/^3\.0\./);
    expect(doc.info).toMatchObject({ title: '모든 API', version: 'v0.4' });
  });

  it('시험 대상 작업이 프론트 계약과 같다', () => {
    expect(diffContract(contract, doc, TRIAL)).toEqual([]);
  });

  describe('비교 함수가 틀린 것을 잡는다', () => {
    it('없는 작업', () => {
      // 아직 옮기지 않은 작업이어야 한다. 옮기면 다른 것으로 바꾼다.
      const problems = diffContract(contract, doc, {
        operations: ['getIntroList'],
      });
      expect(problems).toContain('getIntroList: 작업이 없다');
    });

    it('빠진 필드', () => {
      const bad = structuredClone(doc);
      const schema = bad.components?.schemas?.CommentResponse as SchemaObject;
      delete schema.properties?.writer;
      const problems = diffContract(contract, bad, TRIAL);
      expect(problems.join('\n')).toContain('CommentResponse: 필드가 다르다');
    });

    it('태그가 붙은 작업', () => {
      const bad = structuredClone(doc);
      bad.paths['/api/v1/comment/{commentId}'].delete!.tags = ['댓글 기능'];
      const problems = diffContract(contract, bad, TRIAL);
      expect(problems.join('\n')).toContain('deleteComment: 태그 불일치');
    });

    it('title이 없는 응답(생성기가 모델 이름을 못 정한다)', () => {
      const bad = structuredClone(doc);
      delete addCommentResponse(bad).title;
      const problems = diffContract(contract, bad, TRIAL);
      expect(problems.join('\n')).toContain(
        'addComment: 200 응답 모델 이름 불일치',
      );
    });

    it('공통 껍데기(ResponseDto)에서 빠진 필드', () => {
      const bad = structuredClone(doc);
      const base = bad.components?.schemas?.ResponseDto as SchemaObject;
      delete base.properties?.message;
      const problems = diffContract(contract, bad, TRIAL);
      expect(problems.join('\n')).toContain(
        'ResponseDtoCommentResponse: 필드가 다르다',
      );
    });

    it('data 자리에 엉뚱한 모델이 적힌 응답', () => {
      const bad = structuredClone(doc);
      const part = addCommentResponse(bad).allOf?.[1] as SchemaObject;
      part.properties = {
        data: { $ref: '#/components/schemas/CommentListResponse' },
      };
      const problems = diffContract(contract, bad, TRIAL);
      expect(problems.join('\n')).toContain(
        'ResponseDtoCommentResponse.data: 타입이 다르다',
      );
    });
  });

  describe('실제 응답', () => {
    it('POST도 HTTP 200이고 본문 status는 코드가 넘긴 값이다', async () => {
      const res = await fetch(`${baseUrl}/api/v1/comment/7/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: '글 감사합니다.' }),
      });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body).toMatchObject({ status: 201, data: { commentId: 7 } });
      expect(typeof body.timestamp).toBe('number');
    });

    it('데이터가 없으면 data 키가 없다', async () => {
      const res = await fetch(`${baseUrl}/api/v1/comment/7`, {
        method: 'DELETE',
      });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(Object.keys(body)).toEqual(['status', 'message', 'timestamp']);
    });
  });
});
