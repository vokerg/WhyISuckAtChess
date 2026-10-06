import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  LichessConnectionStartResponseSchema,
  LichessConnectionStatusSchema,
  LichessDisconnectResponseSchema,
  lichessImportRunResponseSchema,
  lichessLatestImportResponseSchema,
  type LichessConnectionStatus,
  type LichessImportRequest,
  type LichessImportRun,
} from '@why-i-suck-at-chess/contracts';
import { map, type Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class LichessOnboardingApiService {
  private readonly http = inject(HttpClient);

  connection(): Observable<LichessConnectionStatus> {
    return this.http.get<unknown>('/api/me/lichess-connection').pipe(
      map((value) => LichessConnectionStatusSchema.parse(value)),
    );
  }

  start(): Observable<string> {
    return this.http.post<unknown>('/api/me/lichess-connection/start', {}).pipe(
      map((value) => LichessConnectionStartResponseSchema.parse(value).url),
    );
  }

  disconnect(): Observable<void> {
    return this.http.delete<unknown>('/api/me/lichess-connection').pipe(
      map((value) => { LichessDisconnectResponseSchema.parse(value); }),
    );
  }

  latest(): Observable<LichessImportRun | null> {
    return this.http.get<unknown>('/api/me/imports/lichess/latest').pipe(
      map((value) => lichessLatestImportResponseSchema.parse(value).importRun),
    );
  }

  create(request: LichessImportRequest): Observable<LichessImportRun> {
    return this.http.post<unknown>('/api/me/imports/lichess', request).pipe(
      map((value) => lichessImportRunResponseSchema.parse(value).importRun),
    );
  }

  run(id: number): Observable<LichessImportRun> {
    return this.http.get<unknown>('/api/me/imports/' + id).pipe(
      map((value) => lichessImportRunResponseSchema.parse(value).importRun),
    );
  }

  cancel(id: number): Observable<LichessImportRun> {
    return this.http.post<unknown>('/api/me/imports/' + id + '/cancel', {}).pipe(
      map((value) => lichessImportRunResponseSchema.parse(value).importRun),
    );
  }
}
