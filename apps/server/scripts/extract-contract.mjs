// 프론트의 생성 코드(src/generated/api)에서 API 계약을 뽑아 contract/front-contract.json에 저장한다.
// 프론트가 실제로 쓰는 클라이언트가 "맞는 명세"의 최종 기준이다.
// 사용: node scripts/extract-contract.mjs <프론트 레포>/src/generated/api
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.argv[2]) {
  console.error('사용: node scripts/extract-contract.mjs <src/generated/api 경로>');
  process.exit(1);
}
const apiDir = resolve(process.argv[2]);
const outFile = join(dirname(fileURLToPath(import.meta.url)), '../contract/front-contract.json');

// 생성기는 예약어 이름 앞에 `_`를 붙인다(delete → _delete). 서버가 내보낼 operationId는 `_`가 없다.
const toOperationId = (name) => name.replace(/^_/, '');

function parseOperations() {
  const text = readFileSync(join(apiDir, 'apis/DefaultApi.ts'), 'utf8');
  const operations = [];
  for (const chunk of text.split(/\n {4}async /).slice(1)) {
    const name = (chunk.match(/^(\w+)Raw\(/) || [])[1];
    if (!name) continue;
    const path = (chunk.match(/let urlPath = `([^`]+)`/) || [])[1];
    const body = (chunk.match(/body: ([^,\n]+)/) || [])[1] || '';
    operations.push({
      operationId: toOperationId(name),
      name,
      method: (chunk.match(/method: '(\w+)'/) || [])[1],
      path,
      query: [...new Set([...chunk.matchAll(/queryParameters\['([\w.]+)'\]/g)].map((m) => m[1]))].sort(),
      // `CommentRequestToJSON(...)`에서 모델 이름만 남긴다. 본문이 없으면 빈 문자열.
      bodyModel: body.replace(/ToJSON\(.*$/, '').trim(),
      multipart: /multipart\/form-data|formParams/.test(chunk),
      bearerAuth: /token\("bearerAuth"/.test(chunk),
      response: (chunk.match(/Promise<runtime\.ApiResponse<([^\n]+?)>>\s*\{/) || [])[1],
    });
  }
  return operations.sort((a, b) => a.operationId.localeCompare(b.operationId));
}

function parseModels() {
  const dir = join(apiDir, 'models');
  const models = {};
  for (const file of readdirSync(dir).sort()) {
    if (file === 'index.ts') continue;
    const block = readFileSync(join(dir, file), 'utf8').match(/export interface (\w+) \{\n([\s\S]*?)\n\}/);
    if (!block) continue;
    const fields = {};
    let description = '';
    for (const line of block[2].split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '/**') description = '';
      else if (trimmed.startsWith('*') && !trimmed.startsWith('* @') && trimmed !== '*/') {
        description = description || trimmed.replace(/^\*\s?/, '');
      } else {
        const field = trimmed.match(/^(\w+)(\?)?: (.+);$/);
        if (field) fields[field[1]] = { optional: Boolean(field[2]), type: field[3], description };
      }
    }
    models[block[1]] = { fields };
  }
  return models;
}

const contract = {
  source: 'GamzaTechBlog-front src/generated/api (openapi-generator 7.14.0, typescript-fetch)',
  operations: parseOperations(),
  models: parseModels(),
};
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(contract, null, 2)}\n`);
console.log(`operations: ${contract.operations.length}, models: ${Object.keys(contract.models).length}`);
