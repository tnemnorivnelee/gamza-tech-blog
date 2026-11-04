import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Pageable } from '../dto/pageable.dto.js';

// 옛 springdoc 설정을 따른다: 그룹 `all`, 제목 "모든 API", `bearerAuth` 전역 적용, 명세 주소 /v3/api-docs/all.
// operationId는 메서드 이름이다. 프론트 생성 클라이언트의 함수 이름이 여기서 나온다.
export function setupSwagger(app: INestApplication, serverUrl?: string) {
  const builder = new DocumentBuilder()
    .setTitle('모든 API')
    .setVersion('v0.4')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearerAuth',
    )
    .addSecurityRequirements('bearerAuth');
  if (serverUrl) builder.addServer(serverUrl);

  const document = SwaggerModule.createDocument(app, builder.build(), {
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
    // 컨트롤러 이름으로 태그가 붙으면 생성기가 DefaultApi 하나가 아니라 태그별 클래스로 나눈다.
    autoTagControllers: false,
    extraModels: [Pageable],
  });
  SwaggerModule.setup('swagger-ui', app, document, {
    jsonDocumentUrl: 'v3/api-docs/all',
  });
}
