import type { RetrievalInspectionRecord } from '../retrieve/types';

/** Process-local last inspection (may include originalQuery for the UI). */
let lastInspection: RetrievalInspectionRecord | undefined;

export function setSessionLastInspection(
  record: RetrievalInspectionRecord | undefined
): void {
  lastInspection = record;
}

export function getSessionLastInspection(): RetrievalInspectionRecord | undefined {
  return lastInspection;
}
