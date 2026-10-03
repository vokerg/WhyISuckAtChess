import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  diagnosisSummaryResponseSchema,
  type DiagnosisSummaryResponse,
} from '@why-i-suck-at-chess/contracts';
import { map, type Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class DiagnosisSummaryApiService {
  private readonly http = inject(HttpClient);

  getSummary(scopeKey = 'overall'): Observable<DiagnosisSummaryResponse> {
    const params = new HttpParams().set('scopeKey', scopeKey);
    return this.http
      .get<unknown>('/api/diagnosis/summary', { params })
      .pipe(map((payload) => diagnosisSummaryResponseSchema.parse(payload)));
  }
}
