import type { INestApplicationContext } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, Reflector } from '@nestjs/core';
import {
  type Access,
  resolveAccess,
} from '../../src/modules/auth/access.decorator.js';

const show = (access: Access) =>
  access === 'public' ? 'public' : [...access].sort().join('|');

// 앱에 등록된 모든 라우트(@Get, @Post 등이 붙은 컨트롤러 메서드)를 찾아서 표와 비교한다.
// 메서드 이름이 곧 operationId라서 표의 키와 바로 맞출 수 있다. 어긋난 곳의 설명을 목록으로 돌려준다.
export function findAccessMismatches(
  app: INestApplicationContext,
  rules: Readonly<Record<string, Access>>,
): string[] {
  const reflector = app.get(Reflector);
  const mismatches: string[] = [];

  for (const { metatype } of app.get(DiscoveryService).getControllers()) {
    if (typeof metatype !== 'function') continue;
    const prototype = metatype.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[name];
      if (
        typeof handler !== 'function' ||
        !Reflect.hasMetadata(METHOD_METADATA, handler)
      )
        continue;

      const where = `${metatype.name}.${name}`;
      const expected = rules[name];
      if (expected === undefined) {
        mismatches.push(`${where}: 접근 규칙 표에 없다`);
        continue;
      }
      const actual = resolveAccess(reflector, handler, metatype);
      if (show(actual) !== show(expected)) {
        mismatches.push(
          `${where}: 표는 ${show(expected)}인데 코드는 ${show(actual)}`,
        );
      }
    }
  }
  return mismatches;
}
