import { expect, test } from 'vitest';

import { FINDINGS_TOOL_NAME } from '../findings/model.js';
import { callSeat, type SeatRequest } from './anthropic.js';

const request: SeatRequest = {
  apiKey: 'test-key-not-a-real-credential',
  model: 'test-model',
  instructions: 'review the diff',
  data: '<<<TWOSEAT_DIFF_abc>>>\n+x\n<<<END_TWOSEAT_DIFF_abc>>>',
  maxOutputTokens: 2048,
};

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const toolReply = {
  content: [
    { type: 'text', text: 'here is what I found' },
    { type: 'tool_use', name: FINDINGS_TOOL_NAME, input: { findings: [{ path: 'a.ts' }] } },
  ],
  usage: { input_tokens: 1200, output_tokens: 340 },
};

test('forces the findings tool, so a seat cannot answer in prose', async () => {
  let sent: Record<string, unknown> = {};
  const fetchImpl = ((_url: string, init: RequestInit) => {
    sent = JSON.parse(init.body as string) as Record<string, unknown>;
    return Promise.resolve(reply(toolReply));
  }) as unknown as typeof fetch;

  await callSeat(request, fetchImpl);

  expect(sent['tool_choice']).toEqual({ type: 'tool', name: FINDINGS_TOOL_NAME });
  expect(sent['model']).toBe('test-model');
  expect(sent['max_tokens']).toBe(2048);
});

test('puts the instructions in the system prompt and the diff in the user turn', async () => {
  let sent: Record<string, unknown> = {};
  const fetchImpl = ((_url: string, init: RequestInit) => {
    sent = JSON.parse(init.body as string) as Record<string, unknown>;
    return Promise.resolve(reply(toolReply));
  }) as unknown as typeof fetch;

  await callSeat(request, fetchImpl);

  expect(sent['system']).toBe('review the diff');
  expect(sent['messages']).toEqual([{ role: 'user', content: request.data }]);
});

test('authenticates with the key header and pins the API version', async () => {
  let headers: Record<string, string> = {};
  let signalled = false;
  const fetchImpl = ((_url: string, init: RequestInit) => {
    headers = init.headers as Record<string, string>;
    signalled = init.signal !== undefined && init.signal !== null;
    return Promise.resolve(reply(toolReply));
  }) as unknown as typeof fetch;

  await callSeat(request, fetchImpl);

  expect(headers['x-api-key']).toBe(request.apiKey);
  expect(headers['anthropic-version']).toBe('2023-06-01');
  // Without a signal a hung API call would hold the job open until the runner
  // timed out, which looks like a stuck check rather than a failed seat.
  expect(signalled).toBe(true);
});

test('returns the tool input and the reported usage on success', async () => {
  const fetchImpl = (() => Promise.resolve(reply(toolReply))) as unknown as typeof fetch;

  const outcome = await callSeat(request, fetchImpl);

  expect(outcome).toEqual({
    kind: 'ok',
    toolInput: { findings: [{ path: 'a.ts' }] },
    usage: { inputTokens: 1200, outputTokens: 340 },
  });
});

test('reports a usage block the API did not send as zero rather than crashing', async () => {
  const fetchImpl = (() =>
    Promise.resolve(
      reply({ content: [{ type: 'tool_use', name: FINDINGS_TOOL_NAME, input: { findings: [] } }] }),
    )) as unknown as typeof fetch;

  const outcome = await callSeat(request, fetchImpl);

  expect(outcome).toMatchObject({ kind: 'ok', usage: { inputTokens: 0, outputTokens: 0 } });
});

test('reports an error status as a failure, naming the status', async () => {
  const fetchImpl = (() =>
    Promise.resolve(reply({ error: { message: 'rate limited' } }, 429))) as unknown as typeof fetch;

  const outcome = await callSeat(request, fetchImpl);

  expect(outcome.kind).toBe('failed');
  expect(outcome.kind === 'failed' && outcome.message).toMatch(/429/);
});

test('caps how much of an error response it repeats into the run log', async () => {
  const fetchImpl = (() =>
    Promise.resolve(new Response('x'.repeat(50_000), { status: 500 }))) as unknown as typeof fetch;

  const outcome = await callSeat(request, fetchImpl);

  expect(outcome.kind === 'failed' && outcome.message.length).toBeLessThan(400);
});

test('never repeats the api key into a failure message', async () => {
  // A client that echoes its own request into an error is not hypothetical, and
  // Actions logs are public on a public repository.
  const fetchImpl = (() =>
    Promise.reject(
      new Error(`connect failed with header x-api-key: ${request.apiKey}`),
    )) as unknown as typeof fetch;

  const outcome = await callSeat(request, fetchImpl);

  expect(outcome.kind).toBe('failed');
  expect(outcome.kind === 'failed' && outcome.message).not.toContain(request.apiKey);
});

test('reports a transport error as a failure instead of throwing', async () => {
  const fetchImpl = (() => Promise.reject(new Error('socket hang up'))) as unknown as typeof fetch;

  const outcome = await callSeat(request, fetchImpl);

  expect(outcome).toEqual({ kind: 'failed', message: 'seat request failed: socket hang up' });
});

test('reports a reply with no tool call as a failure, not as a clean review', async () => {
  // A reply the action cannot parse must never render as "no findings". That
  // would report a malfunction as a passing review.
  const fetchImpl = (() =>
    Promise.resolve(reply({ content: [{ type: 'text', text: 'looks fine' }] }))) as unknown as typeof fetch;

  const outcome = await callSeat(request, fetchImpl);

  expect(outcome.kind).toBe('failed');
  expect(outcome.kind === 'failed' && outcome.message).toMatch(/tool/i);
});

test('reports a body that is not json as a failure', async () => {
  const fetchImpl = (() =>
    Promise.resolve(new Response('<html>gateway error</html>', { status: 200 }))) as unknown as typeof fetch;

  expect((await callSeat(request, fetchImpl)).kind).toBe('failed');
});
