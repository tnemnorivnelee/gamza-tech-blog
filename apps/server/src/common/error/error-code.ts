// 옛 ErrorCode enum을 그대로 옮긴 표. 옛 자바 파일에서 생성했다.
// status는 HTTP 상태, code는 프론트가 body.code로 읽는 문자열이다. message도 그대로 응답에 나간다.
// 값이 이상해 보여도(예: ENTITY_NOT_FOUND가 400) 옛 동작이라 바꾸지 않는다.
export interface ErrorCodeInfo {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

export const ErrorCode = {
  // Common
  INVALID_INPUT_VALUE: {
    status: 400,
    code: 'C001',
    message: '잘못된 입력 값입니다.',
  },
  METHOD_NOT_ALLOWED: {
    status: 405,
    code: 'C002',
    message: '허용되지 않은 메서드입니다.',
  },
  ENTITY_NOT_FOUND: {
    status: 400,
    code: 'C003',
    message: '엔티티를 찾을 수 없습니다.',
  },
  INTERNAL_SERVER_ERROR: {
    status: 500,
    code: 'C004',
    message: '서버 내부 오류가 발생했습니다.',
  },
  INVALID_TYPE_VALUE: {
    status: 400,
    code: 'C005',
    message: '유효하지 않은 타입 값입니다.',
  },
  HANDLE_ACCESS_DENIED: {
    status: 403,
    code: 'C006',
    message: '접근이 거부되었습니다.',
  },

  // JWT
  EXPIRED_JWT: { status: 403, code: 'J001', message: '만료된 JWT 토큰입니다.' },
  UNSUPPORTED_JWT: {
    status: 403,
    code: 'J002',
    message: '지원되지 않는 JWT 토큰입니다.',
  },
  SIGNATURE_INVALID_JWT: {
    status: 403,
    code: 'J003',
    message: '사용중인 시그니처키입니다.',
  },
  JWT_NOT_FOUND: {
    status: 403,
    code: 'J004',
    message: 'JWT 토큰을 찾을 수 없습니다.',
  },
  AUTHENTICATION_FAILED: {
    status: 403,
    code: 'J005',
    message: '인증에 실패했습니다.',
  },

  // User
  USER_NOT_FOUND: {
    status: 404,
    code: 'U001',
    message: '사용자를 찾을 수 없습니다.',
  },
  GITHUB_USER_NOT_FOUND: {
    status: 404,
    code: 'U002',
    message: '깃허브 사용자를 찾을 수 없습니다.',
  },
  USER_ALREADY_REGISTERED: {
    status: 409,
    code: 'U003',
    message: '이미 가입된 사용자입니다.',
  },
  EMAIL_ALREADY_EXISTS: {
    status: 409,
    code: 'U004',
    message: '이미 사용 중인 이메일입니다.',
  },
  NICKNAME_ALREADY_EXISTS: {
    status: 409,
    code: 'U005',
    message: '이미 사용 중인 닉네임입니다.',
  },

  // Profile
  PROFILE_INCOMPLETE: {
    status: 400,
    code: 'U006',
    message: '프로필 정보가 완전하지 않습니다.',
  },
  POSITION_REQUIRED: {
    status: 400,
    code: 'U007',
    message: '직군 정보는 필수입니다.',
  },

  // GitHub OAuth Token
  GITHUB_OAUTH_TOKEN_NOT_FOUND: {
    status: 404,
    code: 'G001',
    message: '깃허브 OAuth 토큰을 찾을 수 없습니다.',
  },
  GITHUB_OAUTH_TOKEN_INVALID: {
    status: 401,
    code: 'G002',
    message: '유효하지 않은 깃허브 OAuth 토큰입니다.',
  },

  // Post
  POST_NOT_FOUND: {
    status: 404,
    code: 'P001',
    message: '게시물을 찾을 수 없습니다.',
  },

  // Comment
  COMMENT_NOT_FOUND: {
    status: 404,
    code: 'CM001',
    message: '댓글을 찾을 수 없습니다.',
  },
  COMMENT_FORBIDDEN: {
    status: 403,
    code: 'CM002',
    message: '댓글 작성자만 수정/삭제할 수 있습니다.',
  },
  PARENT_COMMENT_NOT_FOUND: {
    status: 404,
    code: 'CM003',
    message: '상위 댓글을 찾을 수 없습니다.',
  },
  COMMENT_INVALID_PARENT: {
    status: 400,
    code: 'CM004',
    message: '상위 댓글이 게시글에 속하지 않습니다.',
  },
  COMMENT_UNSUPPORTED_ACTION: {
    status: 400,
    code: 'CM005',
    message: '지원하지 않는 댓글 작업입니다.',
  },

  // 500 Internal Server Error: 서비스/서버 오류
  OAUTH_PROVIDER_ERROR: {
    status: 500,
    code: 'S5001',
    message: 'OAuth 프로바이더 오류입니다.',
  },

  // Like
  ALREADY_LIKED: {
    status: 409,
    code: 'L001',
    message: '이미 좋아요를 눌렀습니다.',
  },
  LIKE_NOT_FOUND: {
    status: 404,
    code: 'L002',
    message: '좋아요를 찾을 수 없습니다.',
  },

  // Profile Image
  PROFILE_IMAGE_EMPTY: {
    status: 400,
    code: 'U008',
    message: '업로드할 파일이 없습니다.',
  },
  PROFILE_IMAGE_SIZE_EXCEEDED: {
    status: 400,
    code: 'U009',
    message: '파일 크기가 최대 용량을 초과했습니다.',
  },
  PROFILE_IMAGE_INVALID_TYPE: {
    status: 400,
    code: 'U010',
    message: '지원하지 않는 파일 형식입니다.',
  },
  PROFILE_IMAGE_UPLOAD_FAILED: {
    status: 500,
    code: 'U011',
    message: '프로필 이미지 업로드에 실패했습니다.',
  },
  PROFILE_IMAGE_DELETE_FAILED: {
    status: 500,
    code: 'U012',
    message: '프로필 이미지 삭제에 실패했습니다.',
  },

  // Project
  PROJECT_NOT_FOUND: {
    status: 404,
    code: 'PR001',
    message: '프로젝트를 찾을 수 없습니다.',
  },
  PROJECT_IMAGE_EMPTY: {
    status: 400,
    code: 'PR002',
    message: '업로드할 프로젝트 이미지가 없습니다.',
  },
  PROJECT_IMAGE_INVALID_TYPE: {
    status: 400,
    code: 'PR003',
    message: '지원하지 않는 프로젝트 이미지 형식입니다.',
  },
  PROJECT_NOT_OWNER: {
    status: 403,
    code: 'PR004',
    message: '프로젝트 소유자가 아닙니다.',
  },

  // ADMIN
  ADMIN_ACCESS_FORBIDDEN: {
    status: 403,
    code: 'A001',
    message: '어드민 권한이 필요합니다.',
  },

  // Admission
  ADMISSION_RESULT_DUPLICATED: {
    status: 409,
    code: 'AD001',
    message: '이미 등록된 합격/불합격 결과입니다.',
  },
  ADMISSION_RESULT_NOT_FOUND: {
    status: 404,
    code: 'AD002',
    message: '합격/불합격 결과를 찾을 수 없습니다.',
  },
  ADMISSION_INVALID_PHONE: {
    status: 400,
    code: 'AD003',
    message: '유효하지 않은 전화번호 형식입니다.',
  },
  ADMISSION_INVALID_STATUS: {
    status: 400,
    code: 'AD004',
    message: '유효하지 않은 상태 값입니다.',
  },

  // Introduction
  INTRO_ALREADY_EXISTS: {
    status: 409,
    code: 'IN001',
    message: '이미 자기소개가 존재합니다.',
  },
  INTRO_NOT_FOUND: {
    status: 404,
    code: 'IN002',
    message: '자기소개가 없습니다.',
  },
  INTRO_DELETE_FORBIDDEN: {
    status: 403,
    code: 'IN003',
    message: '본인만 자기소개를 삭제할 수 있습니다.',
  },
} as const satisfies Record<string, ErrorCodeInfo>;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
