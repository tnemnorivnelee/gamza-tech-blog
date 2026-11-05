import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { GlobalExceptionFilter } from './error/global-exception.filter.js';

// providers는 이 모듈이 Nest에 등록하는 부품 목록이다.
// APP_FILTER라는 이름표로 등록하면 이 예외 필터가 모든 요청에 적용된다.
@Module({
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
export class CommonModule {}
