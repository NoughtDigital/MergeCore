import type { Finding, ReviewResult, Severity } from '../../domain/review-types';

export type SeniorityLevel = 'Senior' | 'Mid-level' | 'Junior' | 'Novice';

export interface ScoreDimension {
  readonly key: 'functionality' | 'style';
  readonly label: string;
  readonly subScore: number;
  readonly level: SeniorityLevel;
}

export interface ScoreInsight {
  readonly whyText: string;
  readonly dimensions: readonly ScoreDimension[];
  readonly strengths: readonly string[];
  readonly pathToTen: readonly string[];
  readonly residualNote?: string;
}

const PENALTY: Record<Severity, number> = {
  info: 0.15,
  hint: 0.25,
  warning: 0.55,
  error: 0.85,
  critical: 1.2,
};

function penaltyFor(f: Finding): number {
  return PENALTY[f.severity] ?? 0.25;
}

function bucketFor(f: Finding): 'functionality' | 'style' {
  if (f.severity === 'warning' || f.severity === 'error' || f.severity === 'critical') {
    return 'functionality';
  }
  return 'style';
}

function clamp10(n: number): number {
  return Math.max(0, Math.min(10, Math.round(n * 100) / 100));
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

function isMockReview(summary: string | undefined): boolean {
  return typeof summary === 'string' && summary.toLowerCase().includes('mock review');
}

export function buildScoreInsight(result: ReviewResult): ScoreInsight {
  const score = clamp10(result.score);
  const findings = [...result.findings];
  const mock = isMockReview(result.summary);

  let funcPenalty = 0;
  let stylePenalty = 0;
  for (const f of findings) {
    const p = penaltyFor(f);
    if (bucketFor(f) === 'functionality') {
      funcPenalty += p;
    } else {
      stylePenalty += p;
    }
  }

  const totalPenaltyRaw = funcPenalty + stylePenalty;
  const totalPenaltyCapped = Math.min(10, totalPenaltyRaw);
  const impliedFromWeights = clamp10(10 - totalPenaltyCapped);

  const funcScore = clamp10(10 - Math.min(10, funcPenalty));
  const styleScore = clamp10(10 - Math.min(10, stylePenalty));

  const dimensions: ScoreDimension[] = [
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
      strengths.push('Behaviour and risk signals look strong relative to weighted deductions.');
    }
    if (styleScore >= 8.5 && funcScore < 8.5) {
      strengths.push('Style and maintainability noise is relatively light compared with other areas.');
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
    pathToTen.push(line);
  }
  if (findings.length > maxSteps) {
    pathToTen.push(`See Findings for ${findings.length - maxSteps} further item(s).`);
  }
  if (pathToTen.length === 0) {
    if (mock) {
      pathToTen.push(
        'Mock mode only samples that bar; connect the API for pack-weighted, senior-style depth and rubric-aligned scores.'
      );
    } else if (score < 10) {
      pathToTen.push(
        'Address any holistic gaps implied by the summary; weighted findings may not explain the last fraction of a point.'
      );
    } else {
      pathToTen.push('Nothing further required for a 10/10 on this run.');
    }
  } else if (score < 10) {
    pathToTen.push('Re-run the review after fixes to confirm the score clears remaining deductions.');
  }

  let whyText: string;
  let residualNote: string | undefined;

  if (mock) {
    whyText =
      'The mock is a thin stand-in for a senior pass: the headline score is hash-jittered from your file (around 9.34) minus 1.25 per deterministic finding. It does not apply your real packs or the full reviewer model.';
    const drift = Math.abs(impliedFromWeights - score);
    if (findings.length > 0 && drift > 0.25) {
      residualNote =
        'Mock score may not match the sum of severity weights because the mock engine does not use the same formula as production.';
    } else if (findings.length === 0) {
      residualNote =
        'With no mock findings, any gap under 10 is expected jitter, not a missed issue list.';
    }
  } else {
    whyText = `MergeCore uses a 10-point scale. Each finding carries a severity weight (for example hint ≈ ${PENALTY.hint}, warning ≈ ${PENALTY.warning}). Those weights are summed (capped) and subtracted from 10 to give an implied score of about ${formatScore(impliedFromWeights)}; your reported score is ${formatScore(score)}.`;
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
  };
}
