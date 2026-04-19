import type { ReviewEngine } from './ports/review-engine.port';
import type { ReviewRequest, ReviewResult } from '../domain/review-types';

export class ReviewCodeUseCase {
  constructor(private readonly engine: ReviewEngine) {}

  execute(request: ReviewRequest): Promise<ReviewResult> {
    return this.engine.review(request);
  }
}
