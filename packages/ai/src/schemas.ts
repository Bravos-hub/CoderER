import { z } from 'zod';
import {
  InvestigationCitationSchema,
  RiskLevel,
  RootCauseHypothesisSchema,
  SandboxCommandRequestSchema,
} from '@codeer/contracts';

export const AgentFindingDraftSchema = z.object({
  summary: z.string().trim().min(10).max(8_000),
  findings: z
    .array(
      z.object({
        claim: z.string().trim().min(5).max(4_000),
        confidence: z.number().min(0).max(1),
        citations: z.array(InvestigationCitationSchema).min(1).max(50),
      }),
    )
    .max(50)
    .default([]),
  missingEvidence: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
  recommendedFocus: z.array(z.string().trim().min(1).max(240)).max(30).default([]),
});
export type AgentFindingDraft = z.infer<typeof AgentFindingDraftSchema>;

export const DiagnosisDraftSchema = z.object({
  summary: z.string().trim().min(10).max(10_000),
  failureMechanism: z.string().trim().min(10).max(10_000),
  blastRadius: z.string().trim().min(3).max(5_000),
  securityImpact: z.string().trim().min(3).max(5_000),
  confidence: z.number().min(0).max(1),
  confidenceBand: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  hypotheses: z
    .array(RootCauseHypothesisSchema.omit({ id: true }))
    .min(1)
    .max(20),
  unknowns: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
  citations: z.array(InvestigationCitationSchema).min(1).max(250),
});
export type DiagnosisDraft = z.infer<typeof DiagnosisDraftSchema>;

export const TreatmentPlanDraftSchema = z.object({
  goal: z.string().trim().min(10).max(4_000),
  risk: z.nativeEnum(RiskLevel),
  steps: z
    .array(
      z.object({
        sequence: z.number().int().positive(),
        title: z.string().trim().min(3).max(240),
        objective: z.string().trim().min(10).max(4_000),
        affectedComponents: z.array(z.string().trim().min(1).max(512)).min(1).max(50),
        scopeRestrictions: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
        risk: z.nativeEnum(RiskLevel),
        securityConsiderations: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
        verificationCommands: z.array(SandboxCommandRequestSchema).max(20).default([]),
        expectedResults: z.array(z.string().trim().min(1).max(1_000)).min(1).max(50),
        rollbackProcedure: z.string().trim().min(10).max(4_000),
        citations: z.array(InvestigationCitationSchema).min(1).max(100),
      }),
    )
    .min(1)
    .max(50),
  verificationMatrix: z
    .array(
      z.object({
        requirement: z.string().trim().min(1).max(1_000),
        evidenceRequired: z.string().trim().min(1).max(1_000),
        mandatory: z.boolean(),
      }),
    )
    .min(1)
    .max(100),
  rollbackStrategy: z.string().trim().min(10).max(10_000),
  compatibilityImpact: z.string().trim().min(3).max(5_000),
  migrationImpact: z.string().trim().min(3).max(5_000),
  knownLimitations: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
  requiredApprovals: z.number().int().min(1).max(10),
});
export type TreatmentPlanDraft = z.infer<typeof TreatmentPlanDraftSchema>;

export const SecurityReviewDraftSchema = z.object({
  approved: z.boolean(),
  summary: z.string().trim().min(10).max(8_000),
  blockers: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
  safeguards: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
  citations: z.array(InvestigationCitationSchema).min(1).max(100),
});
export type SecurityReviewDraft = z.infer<typeof SecurityReviewDraftSchema>;

export const CriticReviewDraftSchema = z.object({
  accepted: z.boolean(),
  summary: z.string().trim().min(10).max(8_000),
  unsupportedClaims: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
  excessiveScope: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
  missingVerification: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
  securityConcerns: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
  citations: z.array(InvestigationCitationSchema).min(1).max(100),
});
export type CriticReviewDraft = z.infer<typeof CriticReviewDraftSchema>;

const citationJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceType', 'sourceId', 'digest', 'label'],
  properties: {
    sourceType: {
      type: 'string',
      enum: [
        'INCIDENT_EVIDENCE',
        'INCIDENT_EVENT',
        'REPRODUCTION',
        'SANDBOX_LOG',
        'SANDBOX_ARTIFACT',
        'REPOSITORY_FILE',
        'REPOSITORY_HEALTH',
      ],
    },
    sourceId: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' },
    digest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    path: { type: 'string' },
    lineStart: { type: 'integer', minimum: 1 },
    lineEnd: { type: 'integer', minimum: 1 },
    label: { type: 'string' },
    excerpt: { type: 'string' },
  },
};

export const agentFindingJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings', 'missingEvidence', 'recommendedFocus'],
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'confidence', 'citations'],
        properties: {
          claim: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          citations: { type: 'array', items: citationJsonSchema },
        },
      },
    },
    missingEvidence: { type: 'array', items: { type: 'string' } },
    recommendedFocus: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const diagnosisDraftJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'failureMechanism',
    'blastRadius',
    'securityImpact',
    'confidence',
    'confidenceBand',
    'hypotheses',
    'unknowns',
    'citations',
  ],
  properties: {
    summary: { type: 'string' },
    failureMechanism: { type: 'string' },
    blastRadius: { type: 'string' },
    securityImpact: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    confidenceBand: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
    hypotheses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'disposition',
          'title',
          'mechanism',
          'confidence',
          'supportingEvidence',
          'contradictingEvidence',
          'missingEvidence',
          'assumptions',
        ],
        properties: {
          disposition: { type: 'string', enum: ['PRIMARY', 'ALTERNATIVE', 'REJECTED'] },
          title: { type: 'string' },
          mechanism: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          supportingEvidence: { type: 'array', items: citationJsonSchema },
          contradictingEvidence: { type: 'array', items: citationJsonSchema },
          missingEvidence: { type: 'array', items: { type: 'string' } },
          assumptions: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    unknowns: { type: 'array', items: { type: 'string' } },
    citations: { type: 'array', items: citationJsonSchema },
  },
} as const;

export const treatmentPlanDraftJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'goal',
    'risk',
    'steps',
    'verificationMatrix',
    'rollbackStrategy',
    'compatibilityImpact',
    'migrationImpact',
    'knownLimitations',
    'requiredApprovals',
  ],
  properties: {
    goal: { type: 'string' },
    risk: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'sequence',
          'title',
          'objective',
          'affectedComponents',
          'scopeRestrictions',
          'risk',
          'securityConsiderations',
          'verificationCommands',
          'expectedResults',
          'rollbackProcedure',
          'citations',
        ],
        properties: {
          sequence: { type: 'integer', minimum: 1 },
          title: { type: 'string' },
          objective: { type: 'string' },
          affectedComponents: { type: 'array', items: { type: 'string' } },
          scopeRestrictions: { type: 'array', items: { type: 'string' } },
          risk: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
          securityConsiderations: { type: 'array', items: { type: 'string' } },
          verificationCommands: { type: 'array', items: { type: 'object' } },
          expectedResults: { type: 'array', items: { type: 'string' } },
          rollbackProcedure: { type: 'string' },
          citations: { type: 'array', items: citationJsonSchema },
        },
      },
    },
    verificationMatrix: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['requirement', 'evidenceRequired', 'mandatory'],
        properties: {
          requirement: { type: 'string' },
          evidenceRequired: { type: 'string' },
          mandatory: { type: 'boolean' },
        },
      },
    },
    rollbackStrategy: { type: 'string' },
    compatibilityImpact: { type: 'string' },
    migrationImpact: { type: 'string' },
    knownLimitations: { type: 'array', items: { type: 'string' } },
    requiredApprovals: { type: 'integer', minimum: 1 },
  },
} as const;

export const securityReviewJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['approved', 'summary', 'blockers', 'safeguards', 'citations'],
  properties: {
    approved: { type: 'boolean' },
    summary: { type: 'string' },
    blockers: { type: 'array', items: { type: 'string' } },
    safeguards: { type: 'array', items: { type: 'string' } },
    citations: { type: 'array', items: citationJsonSchema },
  },
} as const;

export const criticReviewJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'accepted',
    'summary',
    'unsupportedClaims',
    'excessiveScope',
    'missingVerification',
    'securityConcerns',
    'citations',
  ],
  properties: {
    accepted: { type: 'boolean' },
    summary: { type: 'string' },
    unsupportedClaims: { type: 'array', items: { type: 'string' } },
    excessiveScope: { type: 'array', items: { type: 'string' } },
    missingVerification: { type: 'array', items: { type: 'string' } },
    securityConcerns: { type: 'array', items: { type: 'string' } },
    citations: { type: 'array', items: citationJsonSchema },
  },
} as const;
