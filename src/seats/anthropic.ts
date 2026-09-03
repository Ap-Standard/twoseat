/**
 * The primary review seat.
 *
 * Talks to the Messages API over fetch rather than through a client library. A
 * published action ships its own bundle, and one dependency here would drag a
 * transitive tree into a file every consumer executes, for one HTTP call.
 *
 * Two rules govern this file. A seat never throws: every failure comes back as
 * a value, because the caller has to be able to report "the seat did not
 * answer" rather than fail the check. And a failure message never carries the
 * key: Actions logs on a public repository are public.
 */
import { FINDINGS_TOOL, FINDINGS_TOOL_NAME } from '../findings/model.js';
import type { Usage } from '../cost.js';
import { redactSecret, stripInvisible } from '../redact.js';

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

/** Pinned. An unpinned API version would change behavior without a commit. */
export const ANTHROPIC_VERSION = '2023-06-01';

/** A hung call would hold the job open until the runner killed it. */
export const DEFAULT_TIMEOUT_MS = 120_000;

/** How much of an error body reaches the run log. Enough to diagnose, not to dump. */
const MAX_ERROR_BODY_CHARS = 200;

export interface SeatRequest {
  apiKey: string;
  model: string;
  instructions: string;
  /** The fenced data region. Untrusted, and it stays in the user turn. */
  data: string;
  maxOutputTokens: number;
  timeoutMs?: number;
}

export interface SeatSuccess {
  kind: 'ok';
  /** Raw tool input. Untrusted until parseSeatFindings has validated it. */
  toolInput: unknown;
  usage: Usage;
}

export interface SeatFailure {
  kind: 'failed';
  message: string;
}

export type SeatOutcome = SeatSuccess | SeatFailure;

/**
 * Sanitizes text from outside this process before it can be logged.
 *
 * Invisible characters come out first, then the key. A key split by a
 * zero-width character would survive an exact-string redaction, and a later
 * step that strips invisible characters would put it back together.
 */
function sanitize(message: string, apiKey: string): string {
  return redactSecret(stripInvisible(message), apiKey);
}

function readUsage(body: Record<string, unknown>): Usage {
  const usage = body['usage'];
  if (typeof usage !== 'object' || usage === null) {
    return { inputTokens: 0, outputTokens: 0 };
  }

  const source = usage as Record<string, unknown>;
  const input = source['input_tokens'];
  const output = source['output_tokens'];

  return {
    inputTokens: typeof input === 'number' ? input : 0,
    outputTokens: typeof output === 'number' ? output : 0,
  };
}

interface ToolUseBlock {
  type: string;
  name?: string;
  input?: unknown;
}

type ToolInputLookup = { found: true; input: unknown } | { found: false };

/**
 * Finds the forced tool call.
 *
 * The result is wrapped rather than returned bare, because a tool call whose
 * input is genuinely undefined has to stay distinguishable from no tool call at
 * all. The first is a reply to validate; the second is a malfunction.
 */
function findToolInput(body: Record<string, unknown>): ToolInputLookup {
  const content = body['content'];
  if (!Array.isArray(content)) {
    return { found: false };
  }

  for (const block of content as ToolUseBlock[]) {
    if (block.type === 'tool_use' && block.name === FINDINGS_TOOL_NAME) {
      return { found: true, input: block.input };
    }
  }

  return { found: false };
}

export async function callSeat(
  request: SeatRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<SeatOutcome> {
  const body = {
    model: request.model,
    max_tokens: request.maxOutputTokens,
    system: request.instructions,
    tools: [FINDINGS_TOOL],
    // Forced. A seat that could answer in prose would produce a reply the
    // action has to interpret, and interpreting a reply built from a hostile
    // diff is the thing this design avoids.
    tool_choice: { type: 'tool', name: FINDINGS_TOOL_NAME },
    // No sampling controls are sent. A review is a measurement, so run-to-run
    // variance is noise worth suppressing, but `temperature` is deprecated on
    // current models and sending it returns a 400. There is no variance knob to
    // reach for, so comparability comes from pinning the prompt version and
    // fixing the corpus instead. See docs/findings.md.
    messages: [{ role: 'user', content: request.data }],
  };

  let response: Response;
  try {
    response = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'x-api-key': request.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      kind: 'failed',
      message: sanitize(`seat request failed: ${detail}`, request.apiKey),
    };
  }

  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    // Sanitize before truncating. Cutting first can slice a key across the
    // boundary so that neither half matches the redaction, leaving a fragment
    // of a live credential in a public log.
    const snippet = sanitize(raw, request.apiKey)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_ERROR_BODY_CHARS);
    return {
      kind: 'failed',
      message: `seat API returned ${String(response.status)}: ${snippet}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { kind: 'failed', message: 'seat API returned a body that is not JSON' };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { kind: 'failed', message: 'seat API returned a body that is not an object' };
  }

  const lookup = findToolInput(parsed as Record<string, unknown>);
  if (!lookup.found) {
    // Reported as a failure, never as a clean review. Rendering an unparseable
    // reply as "no findings" would present a malfunction as a passing review.
    return {
      kind: 'failed',
      message: `seat replied without calling the ${FINDINGS_TOOL_NAME} tool`,
    };
  }

  return {
    kind: 'ok',
    toolInput: lookup.input,
    usage: readUsage(parsed as Record<string, unknown>),
  };
}
