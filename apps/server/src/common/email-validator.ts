import { domainToASCII } from 'node:url';

// 옛 @Email(jakarta.validation)과 같은 판정이다. 옛 서버가 쓴 Hibernate Validator 8.0.1의
// AbstractEmailValidator와 DomainNameUtil을 읽고 옮겼다(코드를 실행하지 않고 소스만 읽었다).
// 널과 빈 문자열은 @Email이 통과시킨다. null은 호출하는 쪽이 거르고, 빈 문자열은 여기서 true다.
//
// 정규식은 Java와 같은 글자 집합과 같은 모양이다. 두 가지만 짚는다:
// - 옛 도메인 라벨은 (?:C-*)*C++ 였다. 끝의 ++는 소유 한정자(되돌아가지 않는 반복)인데 JS에는 없다. 뒤에 오는 것이 . 또는 끝뿐이라
//   일반 C+와 받는 문자열이 같아서 C+로 옮겼다. 맞지 않는 긴 입력도 제곱 시간(255자 이하)이라 서버가 멈추지 않는다.
// - u 플래그: Java 정규식의 \u0080-\uFFFF는 코드 포인트 범위라서 이모지 같은 BMP 밖 글자를 받지 않는다. u 플래그가 같은 뜻이다.

const LOCAL_ATOM = String.raw`[a-z0-9!#$%&'*+/=?^_\x60{|}~\u0080-\uFFFF-]`;
// 따옴표 안의 글자: 일반 글자, 역슬래시 두 개(\\), 역슬래시+따옴표(\")
const LOCAL_QUOTED_ATOM = String.raw`(?:[a-z0-9!#$%&'*.(),<>\[\]:;  @+/=?^_\x60{|}~\u0080-\uFFFF-]|\\\\|\\")`;
const LOCAL_PART = `(?:${LOCAL_ATOM}+|"${LOCAL_QUOTED_ATOM}+")`;
const LOCAL_PART_PATTERN = new RegExp(
  `^${LOCAL_PART}(?:\\.${LOCAL_PART})*$`,
  'iu',
);

const DOMAIN_CHAR = String.raw`[a-z\u0080-\uFFFF0-9!#$%&'*+/=?^_\x60{|}~]`;
const DOMAIN_LABEL = `(?:${DOMAIN_CHAR}-*)*${DOMAIN_CHAR}+`;
const DOMAIN = `${DOMAIN_LABEL}(?:\\.${DOMAIN_LABEL})*`;

const IP_DOMAIN = String.raw`[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}`;
// IPv6 정규식은 Hibernate 소스에 적힌 것을 그대로 옮겼다.
const IP_V6_DOMAIN = String.raw`(?:(?:[0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(?:(?::[0-9a-fA-F]{1,4}){1,6})|:(?:(?::[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(?::[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(?:ffff(:0{1,4}){0,1}:){0,1}(?:(?:25[0-5]|(?:2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(?:25[0-5]|(?:2[0-4]|1{0,1}[0-9]){0,1}[0-9])|(?:[0-9a-fA-F]{1,4}:){1,4}:(?:(?:25[0-5]|(?:2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(?:25[0-5]|(?:2[0-4]|1{0,1}[0-9]){0,1}[0-9]))`;

// 시험이 직접 확인하려고 내보낸다.
export const EMAIL_DOMAIN_PATTERN = new RegExp(
  `^(?:${DOMAIN}|\\[${IP_DOMAIN}\\]|\\[IPv6:${IP_V6_DOMAIN}\\])$`,
  'iu',
);

const MAX_LOCAL_PART_LENGTH = 64;
const MAX_DOMAIN_LENGTH = 255;
const MAX_LABEL_LENGTH = 63;

// Java의 IDN.toASCII가 거부하는 경우를 흉내 낸다: 라벨이 비었거나 63자를 넘거나(변환 뒤), 전체가 255자를 넘는 경우다.
// shortcut: ASCII가 아닌 도메인의 변환은 Java(IDNA2003)가 아니라 Node(UTS46)가 한다. 한글·유니코드 도메인의 경계 사례가 다를 수 있다.
function fitsAsciiLimits(domain: string): boolean {
  const isAscii = [...domain].every((ch) => ch.charCodeAt(0) < 0x80);
  const ascii = isAscii ? domain : domainToASCII(domain);
  if (ascii === '' || ascii.length > MAX_DOMAIN_LENGTH) return false;
  return ascii
    .split('.')
    .every((label) => label.length > 0 && label.length <= MAX_LABEL_LENGTH);
}

export function isValidEmail(value: string): boolean {
  if (value.length === 0) return true;
  // 따옴표 안에 @가 올 수 있어서 마지막 @에서 자른다.
  const at = value.lastIndexOf('@');
  if (at < 0) return false;
  const localPart = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (localPart.length > MAX_LOCAL_PART_LENGTH) return false;
  if (!LOCAL_PART_PATTERN.test(localPart)) return false;
  // 끝의 점은 IDN.toASCII가 지워 버려서 정규식 전에 따로 거른다.
  if (domain.endsWith('.')) return false;
  return fitsAsciiLimits(domain) && EMAIL_DOMAIN_PATTERN.test(domain);
}
