import type {
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  ReferenceObject,
  SchemaObject,
} from '@nestjs/swagger';

// scripts/extract-contract.mjs가 프론트 생성 코드에서 뽑은 계약(contract/front-contract.json).
export interface Contract {
  operations: ContractOperation[];
  models: Record<string, { fields: Record<string, ContractField> }>;
}

interface ContractOperation {
  operationId: string;
  method: string;
  path: string;
  query: string[];
  bodyModel: string;
  response: string;
  bearerAuth: boolean;
}

interface ContractField {
  optional: boolean;
  type: string;
}

export interface Scope {
  operations: string[];
  /** 작업의 요청·응답에서 따라가지 않아도 확인할 모델(예: 프론트가 직접 import하는 Pageable). */
  models?: string[];
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
type Schema = SchemaObject | ReferenceObject;

const refName = (schema?: Schema) =>
  schema && '$ref' in schema ? schema.$ref.split('/').pop() : undefined;

// 생성기가 만들 TypeScript 타입 이름으로 바꿔 계약과 문자열로 비교한다.
function tsType(schema: Schema): string {
  if ('$ref' in schema) return refName(schema) ?? '?';
  if (schema.enum) return `enum(${schema.enum.join('|')})`;
  switch (schema.type) {
    case 'array':
      return `Array<${schema.items ? tsType(schema.items) : '?'}>`;
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'object';
    case 'string':
      return schema.format === 'date-time' || schema.format === 'date'
        ? 'Date'
        : 'string';
    default:
      return `?${String(schema.type)}`;
  }
}

const firstSchema = (content?: Record<string, { schema?: Schema }>) =>
  content ? Object.values(content)[0]?.schema : undefined;

interface Found {
  method: string;
  path: string;
  operation: OperationObject;
}

function collectOperations(doc: OpenAPIObject, problems: string[]) {
  const found = new Map<string, Found>();
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation?.operationId) continue;
      if (found.has(operation.operationId)) {
        problems.push(`operationId가 겹친다: ${operation.operationId}`);
      }
      found.set(operation.operationId, { method, path, operation });
    }
  }
  return found;
}

const parameterNames = (operation: OperationObject, where: string) =>
  ((operation.parameters ?? []) as ParameterObject[])
    .filter((p) => p.in === where)
    .map((p) => p.name)
    .sort();

function diffOperation(want: ContractOperation, got: Found): string[] {
  const id = want.operationId;
  const problems: string[] = [];
  const same = (what: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      problems.push(
        `${id}: ${what}가 다르다 (계약 ${JSON.stringify(a)}, 서버 ${JSON.stringify(b)})`,
      );
    }
  };

  same('메서드', want.method.toLowerCase(), got.method);
  same('경로', want.path, got.path);
  same(
    '쿼리 파라미터',
    [...want.query].sort(),
    parameterNames(got.operation, 'query'),
  );
  same(
    '경로 파라미터',
    [...want.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(),
    parameterNames(got.operation, 'path'),
  );
  // 태그가 있으면 생성기가 DefaultApi 하나가 아니라 태그별 API 클래스로 나눌 수 있다.
  same('태그', [], got.operation.tags ?? []);
  same(
    '요청 본문 모델',
    want.bodyModel,
    refName(
      firstSchema(
        got.operation.requestBody && 'content' in got.operation.requestBody
          ? got.operation.requestBody.content
          : undefined,
      ),
    ) ?? '',
  );
  const response = got.operation.responses['200'];
  same(
    '200 응답 모델',
    want.response,
    refName(
      firstSchema(
        response && 'content' in response ? response.content : undefined,
      ),
    ),
  );
  return problems;
}

function diffModel(
  name: string,
  contract: Contract,
  doc: OpenAPIObject,
): string[] {
  const want = contract.models[name];
  if (!want) return [`${name}: 계약에 없는 모델이다`];
  const schema = doc.components?.schemas?.[name] as SchemaObject | undefined;
  if (!schema) return [`${name}: 스키마가 없다`];

  const problems: string[] = [];
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const wantNames = Object.keys(want.fields).sort();
  const gotNames = Object.keys(properties).sort();
  if (JSON.stringify(wantNames) !== JSON.stringify(gotNames)) {
    problems.push(
      `${name}: 필드가 다르다 (계약 ${wantNames}, 서버 ${gotNames})`,
    );
  }
  for (const [field, spec] of Object.entries(want.fields)) {
    const prop = properties[field];
    if (!prop) continue;
    if (spec.optional === required.has(field)) {
      problems.push(
        `${name}.${field}: ${spec.optional ? '선택' : '필수'}여야 한다`,
      );
    }
    if (tsType(prop) !== spec.type) {
      problems.push(
        `${name}.${field}: 타입이 다르다 (계약 ${spec.type}, 서버 ${tsType(prop)})`,
      );
    }
  }
  return problems;
}

/** 계약과 다른 점을 문자열 목록으로 돌려준다. 비어 있으면 같다. */
export function diffContract(
  contract: Contract,
  doc: OpenAPIObject,
  scope: Scope,
): string[] {
  const problems: string[] = [];
  const found = collectOperations(doc, problems);
  const wanted = contract.operations.filter((o) =>
    scope.operations.includes(o.operationId),
  );

  for (const id of scope.operations) {
    if (!wanted.some((o) => o.operationId === id))
      problems.push(`${id}: 계약에 없는 작업이다`);
  }

  const queue = [...(scope.models ?? [])];
  for (const want of wanted) {
    const got = found.get(want.operationId);
    if (!got) {
      problems.push(`${want.operationId}: 작업이 없다`);
      continue;
    }
    problems.push(...diffOperation(want, got));
    queue.push(want.response, ...(want.bodyModel ? [want.bodyModel] : []));
  }

  if (wanted.some((o) => o.bearerAuth)) {
    const scheme = doc.components?.securitySchemes?.bearerAuth;
    if (
      !scheme ||
      !('type' in scheme) ||
      scheme.type !== 'http' ||
      scheme.scheme !== 'bearer'
    ) {
      problems.push('bearerAuth 보안 스킴(http bearer)이 없다');
    }
    if (!doc.security?.some((requirement) => 'bearerAuth' in requirement)) {
      problems.push('bearerAuth가 전역으로 적용되지 않았다');
    }
  }

  // 모델은 계약의 필드 타입에서 이름을 따라가며 확인한다.
  const seen = new Set<string>();
  while (queue.length > 0) {
    const name = queue.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    problems.push(...diffModel(name, contract, doc));
    for (const field of Object.values(contract.models[name]?.fields ?? {})) {
      queue.push(
        ...(field.type.match(/\w+/g) ?? []).filter((t) => t in contract.models),
      );
    }
  }
  return problems;
}
