// class-transformer의 자동 형 변환이 Reflect 메타데이터를 쓴다.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, Max, Min, validateSync } from 'class-validator';

export class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;
}

// 부팅 때 한 번 실행한다. 잘못된 값이 있으면 서버를 띄우지 않는다.
// 오류 메시지에는 값을 넣지 않는다(나중에 비밀값이 이 검증을 지나가기 때문).
export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(env);
  if (errors.length > 0) {
    const reasons = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    throw new Error(`환경변수가 올바르지 않습니다: ${reasons.join(', ')}`);
  }
  return env;
}
