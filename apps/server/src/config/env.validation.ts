// class-transformer가 문자열을 숫자로 바꿀 때 Reflect 메타데이터(필드의 타입 정보)를 읽는다.
import 'reflect-metadata';
import { plainToInstance, Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBase64,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsUrl,
  Matches,
  Max,
  Min,
  Validate,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
  ValidateIf,
  validateSync,
} from 'class-validator';

// 직접 만든 검사 규칙. 필드에 @Validate(MinDecodedBytes, [32])처럼 붙이면 validate가 true일 때 통과다.
// Base64로 풀었을 때의 바이트 수를 센다(글자 수로는 모자란다: 44자가 '=='로 끝나면 31바이트).
@ValidatorConstraint({ name: 'minDecodedBytes' })
class MinDecodedBytes implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments) {
    const [min] = args.constraints as [number];
    return (
      typeof value === 'string' && Buffer.from(value, 'base64').length >= min
    );
  }

  // 실패 메시지. 비밀값이 이 검증을 지나가므로 값은 넣지 않는다.
  defaultMessage(args: ValidationArguments) {
    return `${args.property}는 Base64로 풀었을 때 ${String(args.constraints[0])}바이트 이상이어야 합니다`;
  }
}

// 이동 주소의 location 한 칸(서브도메인 이름)의 모양.
const LOCATION_LABEL = /^[a-z0-9-]+$/;

// 필드 위의 @IsInt, @Min 같은 데코레이터는 "이 필드는 이런 값이어야 한다"는 검사 규칙을 붙인다(zod 스키마와 비슷하다).
// 등호 뒤의 값은 환경변수가 없을 때 쓰는 기본값이다.
export class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  // API 명세의 servers 주소. 프론트 gen:api의 BASE_PATH가 여기서 나온다. 비워 두면 생략한다.
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsUrl({ require_protocol: true, require_tld: false })
  OPENAPI_SERVER_URL?: string;

  // JWT 서명 키. jsonwebtoken은 HMAC 키 길이를 검사하지 않아서 여기가 유일한 방어선이다.
  // IsBase64는 글자 종류를, MinDecodedBytes는 푼 길이를 막는다(Buffer.from은 틀린 글자를 조용히 건너뛴다).
  @IsBase64()
  @Validate(MinDecodedBytes, [32])
  JWT_SECRET: string;

  // 토큰 수명(초). jsonwebtoken은 숫자는 초로, 숫자 문자열은 밀리초로 읽는다.
  // 환경변수는 문자열이라 아래 enableImplicitConversion이 숫자로 바꿔 준다.
  @IsInt()
  @Min(1)
  ACCESS_TOKEN_TTL_SECONDS: number = 3600;

  @IsInt()
  @Min(1)
  REFRESH_TOKEN_TTL_SECONDS: number = 2592000;

  // 쿠키의 Domain 속성(예: .gamza.xyz). 비우면 속성을 생략해서 요청한 호스트에만 붙는 쿠키가 된다(로컬 개발용).
  // 운영에서 빼먹으면 쿠키가 프론트 도메인과 공유되지 않아 로그인이 조용히 깨지므로, 운영에서는 필수로 막는다.
  // @ValidateIf: 조건이 참일 때만 이 필드의 검사 규칙을 실행한다. 값이 있으면 개발에서도 모양을 검사한다(틀린 값은 요청마다 500이 된다).
  @Transform(({ value }) => (value === '' ? undefined : value))
  @ValidateIf(
    (env: EnvironmentVariables) =>
      env.NODE_ENV === 'production' || env.COOKIE_DOMAIN !== undefined,
  )
  @IsNotEmpty()
  @Matches(/^\.?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/)
  COOKIE_DOMAIN?: string;

  // Redis 접속 정보. 기본값은 로컬 Compose(docker-compose.dev.yml)가 여는 주소다.
  // "localhost"가 아니라 IPv4 주소를 쓴다: Compose는 127.0.0.1에만 열어서, localhost가 ::1(IPv6)로 풀리면 거부당할 수 있다.
  @IsNotEmpty()
  REDIS_HOST: string = '127.0.0.1';

  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT: number = 6379;

  // 비밀번호는 선택이다. 옛 서버도 비어 있으면 인증 없이 연결했다(CI의 Redis 서비스 컨테이너는 비밀번호가 없다).
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  REDIS_PASSWORD?: string;

  // MySQL 접속 주소(Prisma가 쓴다). 모양은 mysql://사용자:비밀번호@호스트:포트/DB이름이고 비밀번호가 들어 있다. 검증 메시지에 값을 싣지 않는다.
  // COOKIE_DOMAIN과 같은 규칙이다: 운영에서는 필수이고, 그 밖에서는 비워 둘 수 있다(DB 없이도 서버가 뜬다). 값이 있으면 개발에서도 모양을 검사한다.
  // 비밀번호에 @, :, / 같은 글자가 있으면 주소 안에서 %로 인코딩해야 한다(로컬 Compose의 비밀번호는 영문·숫자뿐이라 해당 없다).
  @Transform(({ value }) => (value === '' ? undefined : value))
  @ValidateIf(
    (env: EnvironmentVariables) =>
      env.NODE_ENV === 'production' || env.DATABASE_URL !== undefined,
  )
  @IsNotEmpty()
  @Matches(/^mysql:\/\/\S+$/)
  DATABASE_URL?: string;

  // GitHub OAuth 앱 정보(로그인에 쓴다). COOKIE_DOMAIN과 같은 규칙이다: 운영에서는 필수이고, 그 밖에서는 비워 두면 서버는 뜨지만
  // 로그인 요청에서 막힌다(OAuth 앱을 만들기 전에도 개발 서버를 띄울 수 있게 한다). 값이 있으면 개발에서도 모양을 검사한다.
  // GITHUB_CLIENT_SECRET은 비밀이다. 검증 메시지에 값을 싣지 않는다.
  @Transform(({ value }) => (value === '' ? undefined : value))
  @ValidateIf(
    (env: EnvironmentVariables) =>
      env.NODE_ENV === 'production' || env.GITHUB_CLIENT_ID !== undefined,
  )
  @IsNotEmpty()
  GITHUB_CLIENT_ID?: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @ValidateIf(
    (env: EnvironmentVariables) =>
      env.NODE_ENV === 'production' || env.GITHUB_CLIENT_SECRET !== undefined,
  )
  @IsNotEmpty()
  GITHUB_CLIENT_SECRET?: string;

  // GitHub 앱에 등록한 콜백 전체 주소(예: http://localhost:3000/login/oauth2/code/github). 코드를 토큰으로 바꿀 때도 같은 값을 보낸다.
  @Transform(({ value }) => (value === '' ? undefined : value))
  @ValidateIf(
    (env: EnvironmentVariables) =>
      env.NODE_ENV === 'production' || env.GITHUB_REDIRECT_URI !== undefined,
  )
  @IsUrl({
    require_protocol: true,
    require_tld: false,
    protocols: ['http', 'https'],
  })
  GITHUB_REDIRECT_URI?: string;

  // 로그인이 끝난 뒤 프론트로 돌려보내는 주소 규칙(옛 GithubLoginProperties). 주소는 https://{location}.{접미사}이고,
  // location은 콜백 요청의 쿼리 값을 허용 목록으로 걸러 쓴다(아무 주소로나 보내는 취약점을 막는다). 기본값은 새 프론트(blog.gamza.xyz)다.
  // 정규식이 값을 소문자 영문·숫자·하이픈으로 제한해서, 주소를 만들 때 따로 걸러 낼 필요가 없다.
  @Matches(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/)
  OAUTH_REDIRECT_DOMAIN_SUFFIX: string = 'gamza.xyz';

  @Matches(LOCATION_LABEL)
  OAUTH_DEFAULT_LOCATION: string = 'blog';

  // 쉼표로 구분한 목록(예: blog,dev). 문자열을 배열로 바꾼다. 비어 있으면 어떤 location도 못 쓰므로 막는다.
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((label) => label.trim())
          .filter((label) => label !== '')
      : value,
  )
  @IsArray()
  @ArrayNotEmpty()
  @Matches(LOCATION_LABEL, { each: true })
  OAUTH_ALLOWED_LOCATIONS: string[] = ['blog'];
}

// 부팅 때 한 번 실행된다(ConfigModule이 부른다). 환경변수 객체를 EnvironmentVariables로 바꿔 규칙대로 검사하고,
// 어긋나면 서버를 띄우지 않는다. 오류 메시지에는 값을 넣지 않는다.
export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  // enableImplicitConversion: 필드 타입(number 등)에 맞춰 문자열을 자동으로 바꾼다.
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
