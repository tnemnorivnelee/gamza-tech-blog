// 옛 PagedResponse<T>. page는 0부터 센다.
export class PagedResponse<T> {
  constructor(
    readonly content: T[],
    readonly page: number,
    readonly size: number,
    readonly totalElements: number,
    readonly totalPages: number,
  ) {}
}
