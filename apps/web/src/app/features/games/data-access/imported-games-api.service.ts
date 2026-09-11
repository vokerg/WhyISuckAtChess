import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  importedGameDetailResponseSchema,
  importedGameListResponseSchema,
  importedGameReplayResponseSchema,
  type ImportedGameDetail,
  type ImportedGameListQuery,
  type ImportedGameListResponse,
  type ImportedGameReplay,
} from '@why-i-suck-at-chess/contracts';
import { map, type Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ImportedGamesApiService {
  private readonly http = inject(HttpClient);

  list(query: Partial<ImportedGameListQuery> = {}): Observable<ImportedGameListResponse> {
    let params = new HttpParams();
    if (query.sort) params = params.set('sort', query.sort);
    if (query.limit !== undefined) params = params.set('limit', String(query.limit));
    if (query.cursor) params = params.set('cursor', query.cursor);

    return this.http
      .get<unknown>('/api/imported-games', { params })
      .pipe(map((payload) => importedGameListResponseSchema.parse(payload)));
  }

  getDetail(gameId: number): Observable<ImportedGameDetail> {
    return this.http
      .get<unknown>(`/api/imported-games/${gameId}`)
      .pipe(map((payload) => importedGameDetailResponseSchema.parse(payload)));
  }

  getReplay(gameId: number): Observable<ImportedGameReplay> {
    return this.http
      .get<unknown>(`/api/imported-games/${gameId}/replay`)
      .pipe(map((payload) => importedGameReplayResponseSchema.parse(payload)));
  }
}
