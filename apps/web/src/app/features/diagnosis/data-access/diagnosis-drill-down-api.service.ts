import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  diagnosisDrillDownResponseSchema,
  type DiagnosisDrillDownResponse,
} from '@why-i-suck-at-chess/contracts';
import { map, type Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class DiagnosisDrillDownApiService {
  private readonly http = inject(HttpClient);

  getFinding(findingId: number): Observable<DiagnosisDrillDownResponse> {
    if (!Number.isSafeInteger(findingId) || findingId <= 0) {
      throw new RangeError('findingId must be a positive safe integer.');
    }
    const params = new HttpParams().set('scopeKey', 'overall');
    return this.http
      .get<unknown>(`/api/diagnosis/findings/${findingId}`, { params })
      .pipe(map((payload) => {
        const response = diagnosisDrillDownResponseSchema.parse(payload);
        if (
          response.scopeKey !== 'overall'
          || (response.status === 'AVAILABLE' && response.finding.findingId !== findingId)
        ) {
          throw new Error('Diagnosis drill-down response does not match the request.');
        }
        return response;
      }));
  }
}
