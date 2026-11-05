import { Module } from '@nestjs/common';
import { InMemoryUserRepository } from './in-memory-user.repository.js';
import { UserRepository } from './user.repository.js';

@Module({
  providers: [{ provide: UserRepository, useClass: InMemoryUserRepository }],
  exports: [UserRepository],
})
export class UserModule {}
