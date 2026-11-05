// class-transformer의 자동 형 변환이 Reflect 메타데이터를 쓴다.
import 'reflect-metadata';
import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBase64,
  IsIn,
  IsInt,
  IsOptional,
  IsUrl,
  Max,
  Min,
  Validate,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
  validateSync,
} from 'class-validator';

// Base64로 풀었을 때의 바이트 수를 센다. 문자 수로는 모자라다(44자가 '=='로 끝나면 31바이트다).
// 메시지에 값을 넣지 않는다. 비밀값이 이 검증을 지나간다.
@ValidatorConstraint({ name: 'minDecodedBytes' })
class MinDecodedBytes implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments) {
    const [min] = args.constraints as [number];
    return (
      typeof value === 'string' && Buffer.from(value, 'base64').length >= min
    );
  }

  defaultMessage(args: ValidationArguments) {
    return `${args.property}는 Base64로 풀었을 때 ${String(args.constraints[0])}바이트 이상이어야 합니다`;
  }
}

export class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  // 명세의 servers 항목. 프론트 생성 클라이언트의 BASE_PATH가 여기서 나온다(옛 openapi.server-url).
  // 비워 두면 항목을 내보내지 않는다.
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsUrl({ require_protocol: true, require_tld: false })
  OPENAPI_SERVER_URL?: string;

  // JWT 서명 키(HS256). 옛 jjwt는 Base64로 푼 바이트를 키로 썼고 256비트(32바이트) 미만을 거부했다.
  // jsonwebtoken은 HMAC 키 길이를 검사하지 않으므로(RSA만 검사한다) 여기가 유일한 방어선이다.
  // IsBase64는 글자 종류를 막는다. Buffer.from은 틀린 글자를 조용히 건너뛰기 때문이다.
  @IsBase64()
  @Validate(MinDecodedBytes, [32])
  JWT_SECRET: string;

  // 옛 기본값: 액세스 1시간, 리프레시 30일. jsonwebtoken은 숫자를 초로, 숫자 문자열을 밀리초로 읽는다.
  // 환경변수는 문자열로 들어오므로 반드시 숫자로 바꿔 써야 한다(아래 enableImplicitConversion이 해 준다).
  @IsInt()
  @Min(1)
  ACCESS_TOKEN_TTL_SECONDS: number = 3600;

  @IsInt()
  @Min(1)
  REFRESH_TOKEN_TTL_SECONDS: number = 2592000;
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
