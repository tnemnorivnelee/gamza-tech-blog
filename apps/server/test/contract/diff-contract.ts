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
// 이름 없는 합성(allOf) 스키마는 title이 생성기에게 주는 모델 이름이다.
function tsType(schema: Schema): string {
  if ('$ref' in schema) return refName(schema) ?? '?';
  if (schema.allOf) return schema.title ?? '?';
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

const resolveRef = (doc: OpenAPIObject, schema?: Schema) => {
  if (!schema) return undefined;
  if (!('$ref' in schema)) return schema;
  return doc.components?.schemas?.[refName(schema) ?? ''] as
    SchemaObject | undefined;
};

interface Fields {
  properties: Record<string, Schema>;
  required: Set<string>;
}

// $ref를 따라가고 allOf를 합쳐서 "실제로 이 스키마가 가진 필드"를 만든다.
// 뒤에 오는 조각의 같은 이름 필드가 앞의 것을 덮어쓴다.
function effectiveFields(
  doc: OpenAPIObject,
  schema?: Schema,
): Fields | undefined {
  const resolved = resolveRef(doc, schema);
  if (!resolved) return undefined;

  const fields: Fields = { properties: {}, required: new Set() };
  for (const part of resolved.allOf ?? []) {
    const partFields = effectiveFields(doc, part);
    if (!partFields) continue;
    Object.assign(fields.properties, partFields.properties);
    partFields.required.forEach((name) => fields.required.add(name));
  }
  Object.assign(fields.properties, resolved.properties ?? {});
  (resolved.required ?? []).forEach((name) => fields.required.add(name));
  return fields;
}

const firstSchema = (content?: Record<string, { schema?: Schema }>) =>
  content ? Object.values(content)[0]?.schema : undefined;

const bodySchema = (operation: OperationObject) =>
  firstSchema(
    operation.requestBody && 'content' in operation.requestBody
      ? operation.requestBody.content
      : undefined,
  );

const responseSchema = (operation: OperationObject) => {
  const response = operation.responses['200'];
  return firstSchema(
    response && 'content' in response ? response.content : undefined,
  );
};

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
        `${id}: ${what} 불일치 (계약 ${JSON.stringify(a)}, 서버 ${JSON.stringify(b)})`,
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
    refName(bodySchema(got.operation)) ?? '',
  );
  const response = responseSchema(got.operation);
  same('200 응답 모델 이름', want.response, response && tsType(response));
  return problems;
}

interface Target {
  name: string;
  schema?: Schema;
}

// 프로퍼티가 가리키는 모델 스키마: $ref면 그대로, 배열이면 항목, 아니면 이름 없는 스키마 자신.
const nestedSchema = (prop: Schema): Schema =>
  '$ref' in prop
    ? prop
    : prop.type === 'array' && prop.items
      ? prop.items
      : prop;

function diffModel(
  { name, schema }: Target,
  contract: Contract,
  doc: OpenAPIObject,
): { problems: string[]; nested: Target[] } {
  const want = contract.models[name];
  if (!want) return { problems: [`${name}: 계약에 없는 모델이다`], nested: [] };
  const got = effectiveFields(doc, schema);
  if (!got) return { problems: [`${name}: 스키마가 없다`], nested: [] };

  const problems: string[] = [];
  const wantNames = Object.keys(want.fields).sort();
  const gotNames = Object.keys(got.properties).sort();
  if (JSON.stringify(wantNames) !== JSON.stringify(gotNames)) {
    problems.push(
      `${name}: 필드가 다르다 (계약 ${wantNames}, 서버 ${gotNames})`,
    );
  }

  const nested: Target[] = [];
  for (const [field, spec] of Object.entries(want.fields)) {
    const prop = got.properties[field];
    if (!prop) continue;
    if (spec.optional === got.required.has(field)) {
      problems.push(
        `${name}.${field}: ${spec.optional ? '선택' : '필수'}여야 한다`,
      );
    }
    if (tsType(prop) !== spec.type) {
      problems.push(
        `${name}.${field}: 타입이 다르다 (계약 ${spec.type}, 서버 ${tsType(prop)})`,
      );
    }
    for (const token of spec.type.match(/\w+/g) ?? []) {
      if (token in contract.models)
        nested.push({ name: token, schema: nestedSchema(prop) });
    }
  }
  return { problems, nested };
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

  const queue: Target[] = (scope.models ?? []).map((name) => ({
    name,
    schema: { $ref: `#/components/schemas/${name}` },
  }));
  for (const want of wanted) {
    const got = found.get(want.operationId);
    if (!got) {
      problems.push(`${want.operationId}: 작업이 없다`);
      continue;
    }
    problems.push(...diffOperation(want, got));
    queue.push({ name: want.response, schema: responseSchema(got.operation) });
    if (want.bodyModel)
      queue.push({ name: want.bodyModel, schema: bodySchema(got.operation) });
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

  // 모델은 계약의 필드 타입에서 이름을 따라가며 확인한다. 같은 이름은 한 번만 본다.
  const seen = new Set<string>();
  while (queue.length > 0) {
    const target = queue.pop()!;
    if (seen.has(target.name)) continue;
    seen.add(target.name);
    const result = diffModel(target, contract, doc);
    problems.push(...result.problems);
    queue.push(...result.nested);
  }
  return problems;
}
