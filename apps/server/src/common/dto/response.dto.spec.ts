import { ResponseDto } from './response.dto.js';

const keys = (value: unknown) => Object.keys(JSON.parse(JSON.stringify(value)));

describe('ResponseDto', () => {
  it('상태는 기본 200이고 본문 status로 다른 값을 줄 수 있다', () => {
    expect(ResponseDto.of('성공').status).toBe(200);
    expect(ResponseDto.of('등록', { id: 1 }, 201).status).toBe(201);
  });

  it('data가 없거나 null이면 키를 뺀다', () => {
    expect(keys(ResponseDto.of('성공'))).toEqual([
      'status',
      'message',
      'timestamp',
    ]);
    expect(keys(ResponseDto.of('성공', null))).toEqual([
      'status',
      'message',
      'timestamp',
    ]);
  });

  it.each([0, false, ''])('값 %j은 null이 아니므로 data로 남긴다', (data) => {
    expect(keys(ResponseDto.of('성공', data))).toEqual([
      'status',
      'message',
      'data',
      'timestamp',
    ]);
    expect(JSON.parse(JSON.stringify(ResponseDto.of('성공', data))).data).toBe(
      data,
    );
  });
});
