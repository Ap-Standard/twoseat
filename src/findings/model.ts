/**
 * The findings contract.
 *
 * A seat does not reply in prose. It is required to call one tool whose schema
 * is declared here, which is what makes a reply parseable rather than
 * interpreted. The schema is part of the prompt contract: the fingerprint test
 * in src/prompt/assemble.test.ts covers it, so changing a field without bumping
 * PROMPT_VERSION fails CI.
 */

export type Severity = 'P1' | 'P2';
export type Confidence = 'high' | 'medium' | 'low';

export const SEVERITIES: readonly Severity[] = ['P1', 'P2'];
export const CONFIDENCES: readonly Confidence[] = ['high', 'medium', 'low'];

/**
 * Defect classes, for grouping scores by the kind of thing a seat catches.
 *
 * The list is deliberately wider than what any corpus seeds. A taxonomy that
 * exactly mirrored the answer key would hand a seat the list of things to hunt
 * for, and the resulting per-category scores would say more about the schema
 * than about the seat. Enumerating it at all is still a measurement artifact,
 * disclosed in bench/README.md.
 *
 * An unrecognized or absent value becomes `other` rather than rejecting the
 * finding. The location of a defect is the valuable half of a report and the
 * label is the cosmetic half, so the label never costs the finding.
 */
export const CATEGORIES = [
  'sql-injection',
  'missing-await',
  'toctou',
  'secret-in-diff',
  'n-plus-one',
  'unsafe-migration',
  'authz-bypass',
  'error-swallowing',
  'resource-leak',
  'input-validation',
  'unsafe-deserialization',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const FALLBACK_CATEGORY: Category = 'other';

export interface Finding {
  /** Which seat reported it. Attribution survives into the comment. */
  seat: string;
  /** The model id behind that seat, recorded so a score names its model. */
  model: string;
  path: string;
  /** Line in the file as the diff leaves it, validated against the hunks. */
  line: number;
  severity: Severity;
  confidence: Confidence;
  /** Defect class. `other` when the seat gave none this action recognizes. */
  category: Category;
  title: string;
  detail: string;
}

export const FINDINGS_TOOL_NAME = 'report_findings';

export const FINDINGS_TOOL = {
  name: FINDINGS_TOOL_NAME,
  description:
    'Report every defect you found in the diff under review. Report an empty ' +
    'list when the diff contains no defect you can anchor to a line it changes.',
  input_schema: {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        description: 'One entry per defect. Empty when there is nothing to report.',
        items: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description:
                'Path of the file, copied exactly as it appears in the diff under review.',
            },
            line: {
              type: 'integer',
              description:
                'Line number in the file as the diff leaves it. Must fall inside a hunk of that file.',
            },
            severity: {
              type: 'string',
              enum: ['P1', 'P2'],
              description:
                'P1 for a defect that should stop a merge. P2 for one worth raising but not stopping.',
            },
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'How sure you are that this defect is real.',
            },
            category: {
              type: 'string',
              enum: [...CATEGORIES],
              description:
                'The kind of defect. Use other when none of the listed classes fits, ' +
                'rather than forcing a poor match.',
            },
            title: {
              type: 'string',
              description: 'One line naming the defect.',
            },
            detail: {
              type: 'string',
              description: 'What breaks, and the input or state under which it breaks.',
            },
          },
          required: ['path', 'line', 'severity', 'confidence', 'category', 'title', 'detail'],
          additionalProperties: false,
        },
      },
    },
    required: ['findings'],
    additionalProperties: false,
  },
} as const;
