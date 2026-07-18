import type { ReviewResult } from '../../domain/review-types';
import {
  bucketForCategory,
  clampScore10,
  penaltyForSeverity,
  SEVERITY_PENALTY,
} from '../../domain/score-weights';

export type SeniorityLevel = 'Senior' | 'Mid-level' | 'Junior' | 'Novice' | 'Mock band';

export interface ScoreDimension {
  readonly key: 'functionality' | 'style';
  readonly label: string;
  readonly subScore: number;
  readonly level: SeniorityLevel | '';
}

export interface ScoreInsight {
  readonly whyText: string;
  readonly dimensions: readonly ScoreDimension[];
  readonly strengths: readonly string[];
  readonly pathToTen: readonly string[];
  readonly residualNote?: string;
  /** Present for mock reviews — honest badge copy for the sidebar. */
  readonly mockBadge?: string;
}

function levelForSubScore(s: number): SeniorityLevel {
  if (s >= 9) {
    return 'Senior';
  }
  if (s >= 7.5) {
    return 'Mid-level';
  }
  if (s >= 6) {
    return 'Junior';
  }
  return 'Novice';
}

function formatScore(n: number): string {
  if (n % 1 === 0) {
    return String(Math.round(n));
  }
  return String(Number(n.toFixed(2)));
}

export function isMockReview(summary: string | undefined): boolean {
  return typeof summary === 'string' && summary.toLowerCase().includes('mock review');
}

export function buildScoreInsight(result: ReviewResult): ScoreInsight {
  const score = clampScore10(result.score);
  const findings = [...result.findings];
  const mock = isMockReview(result.summary);

  let funcPenalty = 0;
  let stylePenalty = 0;
  for (const f of findings) {
    const p = penaltyForSeverity(f.severity);
    if (bucketForCategory(f.category) === 'functionality') {
      funcPenalty += p;
    } else {
      stylePenalty += p;
    }
  }

  const totalPenaltyRaw = funcPenalty + stylePenalty;
  const totalPenaltyCapped = Math.min(10, totalPenaltyRaw);
  const impliedFromWeights = clampScore10(10 - totalPenaltyCapped);

  const funcScore = clampScore10(10 - Math.min(10, funcPenalty));
  const styleScore = clampScore10(10 - Math.min(10, stylePenalty));

  const dimensions: ScoreDimension[] = mock
    ? [
        {
          key: 'functionality',
          label: 'Rule pressure',
          subScore: funcScore,
          level: 'Mock band',
        },
        {
          key: 'style',
          label: 'Convention fit',
          subScore: styleScore,
          level: 'Mock band',
        },
      ]
    : [
        {
          key: 'functionality',
          label: 'Functionality and risk',
          subScore: funcScore,
          level: levelForSubScore(funcScore),
        },
        {
          key: 'style',
          label: 'Style and maintainability',
          subScore: styleScore,
          level: levelForSubScore(styleScore),
        },
      ];

  const strengths: string[] = [];
  if (findings.length === 0) {
    strengths.push('Nothing flagged against the active rule checks for this run.');
  } else {
    const high = findings.filter((f) => f.severity === 'error' || f.severity === 'critical');
    if (high.length === 0) {
      strengths.push('No error- or critical-level findings for this scope.');
    }
    if (funcScore >= 8.5) {
      strengths.push(
        mock
          ? 'Rule-pressure deductions are light relative to this run.'
          : 'Behaviour and risk signals look strong relative to weighted deductions.'
      );
    }
    if (styleScore >= 8.5 && funcScore < 8.5) {
      strengths.push(
        mock
          ? 'Convention-fit noise is relatively light compared with other areas.'
          : 'Style and maintainability noise is relatively light compared with other areas.'
      );
    }
    if (strengths.length === 0) {
      strengths.push('Review surfaced specific, actionable items rather than vague concerns.');
    }
  }

  const pathToTen: string[] = [];
  const maxSteps = 10;
  for (let i = 0; i < findings.length && i < maxSteps; i++) {
    const f = findings[i];
    const hint = f.fixHint?.trim();
    const line = hint ? `${f.message} — ${hint}` : f.message;
    if (mock) {
      pathToTen.push(`Mock rule hit: ${line}`);
    } else {
      pathToTen.push(line);
    }
  }
  if (findings.length > maxSteps) {
    pathToTen.push(`See Findings for ${findings.length - maxSteps} further item(s).`);
  }
  if (pathToTen.length === 0) {
    if (mock) {
      pathToTen.push('Connect the API for pack-scored review — mock mode only samples deterministic rules.');
    } else if (score < 10) {
      pathToTen.push(
        'Address any holistic gaps implied by the summary; weighted findings may not explain the last fraction of a point.'
      );
    } else {
      pathToTen.push('Nothing further required for a 10/10 on this run.');
    }
  } else if (score < 10 && !mock) {
    pathToTen.push('Re-run the review after fixes to confirm the score clears remaining deductions.');
  }

  let whyText: string;
  let residualNote: string | undefined;

  if (mock) {
    whyText =
      'Mock · deterministic rules · not pack-scored. Headline = 10 minus shared severity weights (same table as the dimensions below). Estimated from findings — not a senior score.';
    if (findings.length === 0) {
      residualNote =
        'With no mock findings, any gap under 10 is demo variance (±0.1), not a missed issue list.';
    }
  } else {
    whyText = `MergeCore uses a 10-point scale. Each finding carries a severity weight (for example hint ≈ ${SEVERITY_PENALTY.hint}, warning ≈ ${SEVERITY_PENALTY.warning}). Those weights are summed (capped) and subtracted from 10 to give an implied score of about ${formatScore(impliedFromWeights)}; your reported score is ${formatScore(score)}.`;
    const drift = Math.abs(impliedFromWeights - score);
    if (findings.length > 0 && drift > 0.35) {
      residualNote =
        'The headline score differs from the raw weighted sum; the model may blend holistic judgement with rule weights.';
    } else if (findings.length === 0 && score < 10) {
      residualNote =
        'With no listed findings, a score below 10 usually reflects holistic review or host rounding rather than empty rule hits.';
    }
  }

  return {
    whyText,
    dimensions,
    strengths,
    pathToTen,
    residualNote,
    mockBadge: mock ? 'Mock · deterministic rules · not pack-scored' : undefined,
  };
}
