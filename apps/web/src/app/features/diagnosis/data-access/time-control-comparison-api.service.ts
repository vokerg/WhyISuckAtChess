import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  timeControlComparisonResponseSchema,
  type TimeControlComparisonQuery,
  type TimeControlComparisonResponse,
} from '@why-i-suck-at-chess/contracts';
import { map, type Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class TimeControlComparisonApiService {
  private readonly http = inject(HttpClient);

  getComparisons(query: TimeControlComparisonQuery = {}): Observable<TimeControlComparisonResponse> {
    let params = new HttpParams();
    if (query.from) params = params.set('from', query.from);
    if (query.to) params = params.set('to', query.to);

    return this.http
      .get<unknown>('/api/diagnosis/time-controls', { params })
      .pipe(map((payload) => timeControlComparisonResponseSchema.parse(payload)));
  }
}
