import type { ReviewRequest, ReviewResult } from '../../domain/review-types';

export interface ReviewEngine {
  review(request: ReviewRequest): Promise<ReviewResult>;
}
