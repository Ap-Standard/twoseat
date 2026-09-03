/**
 * Seat output validation.
 *
 * A seat's reply is untrusted. It is produced from a diff that whoever opened
 * the pull request controls, so it can carry an invented file, a line the seat
 * never saw, a severity outside the published scale, or a field long enough to
 * bury a reviewer. Every field is checked against what the run actually sent
 * before it can reach a comment.
 *
 * Nothing is dropped quietly. Each rejection carries a reason and is counted in
 * the summary comment, because a gate that silently discards half a review
 * looks identical to a gate that found nothing.
 */
import { isAnchoredInDiff, type AnchorableFile } from './anchors.js';
import {
  CATEGORIES,
  CONFIDENCES,
  FALLBACK_CATEGORY,
  SEVERITIES,
  type Category,
  type Confidence,
  type Finding,
  type Severity,
} from './model.js';

/** Caps on seat-authored text, so one finding cannot swamp the comment. */
export const MAX_TITLE_CHARS = 160;
export const MAX_DETAIL_CHARS = 800;

/**
 * Ceiling on findings from a single seat. A reply longer than this is a
 * malfunction rather than a review, and a comment that long goes unread.
 */
export const MAX_FINDINGS = 40;

export type RejectReason =
  | 'malformed'
  | 'unknown-file'
  | 'unanchored-line'
  | 'bad-severity'
  | 'bad-confidence'
  | 'duplicate'
  | 'over-limit';

export interface RejectedFinding {
  reason: RejectReason;
  /** Null when the reply was not shaped like a finding at all. */
  path: string | null;
}

export interface ParsedFindings {
  findings: Finding[];
  rejected: RejectedFinding[];
}

export interface ParseContext {
  seat: string;
  model: string;
  files: readonly AnchorableFile[];
}

/**
 * Whether a reply is shaped like a findings list at all.
 *
 * This is a different question from whether the entries inside it are valid.
 * One bad entry among good ones is a rejection to count. A reply that is not a
 * findings list is a protocol failure, and a caller that renders it as a review
 * with zero findings would report a malfunction as a clean review.
 */
export function isFindingsPayload(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return false;
  }
  return Array.isArray((raw as { findings?: unknown }).findings);
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 1)}…`;
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Codepoint ordering, so a plan does not vary with the runner's locale. */
function byText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function bySeverityThenLocation(a: Finding, b: Finding): number {
  const severityDelta = SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);
  if (severityDelta !== 0) return severityDelta;

  const pathDelta = byText(a.path, b.path);
  if (pathDelta !== 0) return pathDelta;

  if (a.line !== b.line) return a.line - b.line;
  return byText(a.title, b.title);
}

export function parseSeatFindings(raw: unknown, context: ParseContext): ParsedFindings {
  if (!isFindingsPayload(raw)) {
    // Defense in depth. Callers are expected to check isFindingsPayload and
    // report a protocol failure, so reaching here means one did not, and a
    // single malformed rejection is the safest thing left to return.
    return { findings: [], rejected: [{ reason: 'malformed', path: null }] };
  }

  const entries = (raw as { findings: unknown[] }).findings;
  const findings: Finding[] = [];
  const rejected: RejectedFinding[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      rejected.push({ reason: 'malformed', path: null });
      continue;
    }

    const source = entry as Record<string, unknown>;
    const path = readString(source, 'path');
    const title = readString(source, 'title');
    const detail = readString(source, 'detail');
    const line = source['line'];

    if (path === null || title === null || detail === null || typeof line !== 'number') {
      rejected.push({ reason: 'malformed', path });
      continue;
    }

    const severity = readString(source, 'severity');
    if (severity === null || !SEVERITIES.includes(severity as Severity)) {
      rejected.push({ reason: 'bad-severity', path });
      continue;
    }

    const confidence = readString(source, 'confidence');
    if (confidence === null || !CONFIDENCES.includes(confidence as Confidence)) {
      rejected.push({ reason: 'bad-confidence', path });
      continue;
    }

    // Unknown file before unanchored line. Both are rejections, but "the seat
    // named a file we never sent" and "the seat missed the line" are different
    // failures and a scorecard should not confuse them.
    if (!context.files.some((file) => file.path === path)) {
      rejected.push({ reason: 'unknown-file', path });
      continue;
    }

    if (!isAnchoredInDiff(context.files, path, line)) {
      rejected.push({ reason: 'unanchored-line', path });
      continue;
    }

    // Self-delimiting, so a path ending in the separator cannot collide
    // with the next field. A literal separator byte here once made this
    // whole file binary to git, which cost it its patch and its review.
    // An unrecognized or absent category costs the classification, never the
    // finding. A correctly located defect is worth keeping under `other`.
    const rawCategory = readString(source, 'category');
    const category: Category =
      rawCategory !== null && CATEGORIES.includes(rawCategory as Category)
        ? (rawCategory as Category)
        : FALLBACK_CATEGORY;

    const key = JSON.stringify([path, line, title]);
    if (seen.has(key)) {
      rejected.push({ reason: 'duplicate', path });
      continue;
    }
    seen.add(key);

    if (findings.length >= MAX_FINDINGS) {
      rejected.push({ reason: 'over-limit', path });
      continue;
    }

    findings.push({
      seat: context.seat,
      model: context.model,
      path,
      line,
      severity: severity as Severity,
      confidence: confidence as Confidence,
      category,
      title: truncate(title, MAX_TITLE_CHARS),
      detail: truncate(detail, MAX_DETAIL_CHARS),
    });
  }

  return { findings: findings.sort(bySeverityThenLocation), rejected };
}
