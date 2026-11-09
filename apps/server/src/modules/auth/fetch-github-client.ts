import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { GithubClient, type GithubProfile } from './github-client.js';

const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const PROFILE_URL = 'https://api.github.com/user';
const EMAILS_URL = 'https://api.github.com/user/emails';

// 옛 OAuth2ClientConfig는 연결 2초, 응답 5초로 제한했다. fetch는 둘을 나눌 수 없어 요청 전체를 5초로 하나만 둔다.
// 시간이 지나면 fetch가 던져서 로그인 실패가 된다(GitHub가 느릴 때 요청이 매달리지 않는다).
const TIMEOUT_MS = 5000;

// 외부 서버의 응답은 믿지 않고 모양을 확인한다(신뢰 경계). isRecord와 text는 그 확인에 쓰는 작은 도구다.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

// 옛 GithubApiClient의 로그인 부분을 내장 fetch로 옮긴 구현이다. 시험은 전역 fetch를 가짜로 바꿔서 확인한다.
// 오류 메시지에는 토큰·비밀값·code를 싣지 않는다(상태 코드와 GitHub의 오류 이름만 싣는다).
@Injectable()
export class FetchGithubClient extends GithubClient {
  constructor(private readonly config: ConfigService<EnvironmentVariables>) {
    super();
  }

  async exchangeCode(code: string): Promise<string> {
    const clientId = this.config.get('GITHUB_CLIENT_ID', { infer: true });
    const clientSecret = this.config.get('GITHUB_CLIENT_SECRET', {
      infer: true,
    });
    const redirectUri = this.config.get('GITHUB_REDIRECT_URI', { infer: true });
    // 운영이 아니면 비워 둘 수 있다(M3-1까지는 OAuth 앱 없이도 서버가 뜬다). 비어 있는 채로 부르면 여기서 막는다.
    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error('GitHub OAuth 환경변수(GITHUB_*)가 설정되지 않았습니다');
    }

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`GitHub 액세스 토큰 요청 실패: HTTP ${res.status}`);
    }
    // GitHub는 code가 틀려도 HTTP 200으로 답하고 본문에 error를 담는다. 옛 코드처럼 access_token이 없으면 실패다.
    const body: unknown = await res.json();
    const accessToken = isRecord(body) ? text(body.access_token) : null;
    if (!accessToken) {
      const reason = isRecord(body) ? text(body.error) : null;
      throw new Error(
        `GitHub 액세스 토큰 요청 실패: ${reason ?? 'access_token이 없습니다'}`,
      );
    }
    return accessToken;
  }

  async fetchProfile(accessToken: string): Promise<GithubProfile> {
    const body = await this.get(PROFILE_URL, accessToken, 'GitHub 프로필 조회');
    // id가 없는 채로 통과시키면 "g_undefined" 사용자가 만들어진다. 최소한만 확인한다.
    if (
      !isRecord(body) ||
      typeof body.id !== 'number' ||
      typeof body.login !== 'string'
    ) {
      throw new Error('GitHub 프로필 응답 형식이 올바르지 않습니다');
    }
    return {
      id: body.id,
      login: body.login,
      name: text(body.name),
      email: text(body.email),
      avatarUrl: text(body.avatar_url),
    };
  }

  async fetchPrimaryEmail(accessToken: string): Promise<string> {
    const body = await this.get(EMAILS_URL, accessToken, 'GitHub 이메일 조회');
    if (Array.isArray(body)) {
      // 옛 코드와 같다: 주 이메일이면서 인증된 첫 번째 것.
      for (const entry of body as unknown[]) {
        if (
          isRecord(entry) &&
          entry.primary === true &&
          entry.verified === true &&
          typeof entry.email === 'string'
        ) {
          return entry.email;
        }
      }
    }
    throw new Error('GitHub 주 이메일(인증됨)을 찾을 수 없습니다');
  }

  // 프로필·이메일 조회가 같은 모양이다. Bearer는 "이 토큰을 가진 사람으로서 요청한다"는 인증 헤더다.
  private async get(
    url: string,
    accessToken: string,
    what: string,
  ): Promise<unknown> {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${what} 실패: HTTP ${res.status}`);
    return res.json();
  }
}
