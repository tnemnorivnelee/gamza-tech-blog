import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { setupSwagger } from './common/swagger/setup-swagger.js';
import type { EnvironmentVariables } from './config/env.validation.js';

async function bootstrap() {
  // AppModule에서 시작해 모듈과 의존성을 모두 조립해 앱을 만든다. 이때 환경변수 검증도 실행된다.
  const app = await NestFactory.create(AppModule);
  // 조립된 부품은 app.get으로 꺼낸다. ConfigService는 환경변수 값을 읽는 부품이다.
  const config =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  // API 명세(Swagger) 문서를 설정한다.
  setupSwagger(app, config.get('OPENAPI_SERVER_URL', { infer: true }));
  // 포트를 열고 요청을 받기 시작한다.
  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
