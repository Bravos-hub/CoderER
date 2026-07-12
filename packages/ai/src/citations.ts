import {
  HypothesisDisposition,
  type Diagnosis,
  type InvestigationCitation,
  type TreatmentPlan,
} from '@codeer/contracts';
import type { InvestigationContextPackage } from './context.js';

export interface CitationValidationResult {
  valid: boolean;
  errors: string[];
  validatedCount: number;
}

function citationKey(citation: InvestigationCitation): string {
  return [
    citation.sourceType,
    citation.sourceId,
    citation.digest,
    citation.path ?? '',
    citation.lineStart ?? '',
    citation.lineEnd ?? '',
  ].join(':');
}

export function validateCitations(
  citations: readonly InvestigationCitation[],
  context: InvestigationContextPackage,
): CitationValidationResult {
  const errors: string[] = [];
  const items = new Map(
    context.items.map((item) => [`${item.sourceType}:${item.sourceId}:${item.digest}`, item]),
  );
  const seen = new Set<string>();

  for (const citation of citations) {
    const key = `${citation.sourceType}:${citation.sourceId}:${citation.digest}`;
    const item = items.get(key);
    if (!item) {
      errors.push(`Citation does not reference an item in the committed context: ${key}`);
      continue;
    }
    if (citation.path && item.path && citation.path !== item.path) {
      errors.push(`Citation path does not match context provenance for ${citation.sourceId}.`);
    }
    if (
      citation.lineStart !== undefined &&
      item.lineStart !== undefined &&
      citation.lineStart < item.lineStart
    ) {
      errors.push(`Citation begins outside the available line range for ${citation.sourceId}.`);
    }
    if (
      citation.lineEnd !== undefined &&
      item.lineEnd !== undefined &&
      citation.lineEnd > item.lineEnd
    ) {
      errors.push(`Citation ends outside the available line range for ${citation.sourceId}.`);
    }
    const duplicate = citationKey(citation);
    if (seen.has(duplicate)) errors.push(`Duplicate citation detected: ${duplicate}`);
    seen.add(duplicate);
  }

  return { valid: errors.length === 0, errors, validatedCount: citations.length - errors.length };
}

export function validateDiagnosisGrounding(
  diagnosis: Diagnosis,
  context: InvestigationContextPackage,
): CitationValidationResult {
  const result = validateCitations(diagnosis.citations, context);
  const declared = new Set(diagnosis.citations.map(citationKey));

  for (const hypothesis of diagnosis.hypotheses) {
    const hypothesisCitations = [
      ...hypothesis.supportingEvidence,
      ...hypothesis.contradictingEvidence,
    ];
    const hypothesisResult = validateCitations(hypothesisCitations, context);
    result.errors.push(...hypothesisResult.errors);
    result.validatedCount += hypothesisResult.validatedCount;
    for (const citation of hypothesisCitations) {
      if (!declared.has(citationKey(citation))) {
        result.errors.push(
          `Hypothesis citation is not declared in the diagnosis citation index: ${citationKey(citation)}`,
        );
      }
    }
  }
  if (
    !diagnosis.hypotheses.some(
      (hypothesis) => hypothesis.disposition === HypothesisDisposition.PRIMARY,
    )
  ) {
    result.errors.push('Diagnosis does not contain a primary hypothesis.');
  }
  if (diagnosis.confidence > 0.8 && diagnosis.unknowns.length > 10) {
    result.errors.push('High confidence is inconsistent with the number of unresolved unknowns.');
  }
  result.valid = result.errors.length === 0;
  return result;
}

export function validateTreatmentPlanGrounding(
  plan: TreatmentPlan,
  context: InvestigationContextPackage,
): CitationValidationResult {
  const result = validateCitations(
    plan.steps.flatMap((step) => step.citations),
    context,
  );
  const sequences = plan.steps.map((step) => step.sequence);
  if (new Set(sequences).size !== sequences.length) {
    result.errors.push('Treatment plan step sequences must be unique.');
  }
  if (sequences.some((sequence, index) => sequence !== index + 1)) {
    result.errors.push('Treatment plan step sequences must be contiguous and one-based.');
  }
  if (!plan.rollbackStrategy.trim()) result.errors.push('Rollback strategy is required.');
  result.valid = result.errors.length === 0;
  return result;
}
