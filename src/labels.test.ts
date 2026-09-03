import { expect, test } from 'vitest';

import { syncUnreviewedLabel, type LabelClient } from './labels.js';
import { UNREVIEWED_LABEL } from './policy.js';

function clientRecording(behavior: Partial<LabelClient> = {}) {
  const added: string[] = [];
  const removed: string[] = [];

  const client: LabelClient = {
    add: (name) => {
      added.push(name);
      return behavior.add ? behavior.add(name) : Promise.resolve();
    },
    remove: (name) => {
      removed.push(name);
      return behavior.remove ? behavior.remove(name) : Promise.resolve();
    },
  };

  return { client, added, removed };
}

function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error('the API said no'), { status });
}

test('applies the label when the run did not review', async () => {
  const { client, added, removed } = clientRecording();

  const warning = await syncUnreviewedLabel(client, true);

  expect(added).toEqual([UNREVIEWED_LABEL]);
  expect(removed).toEqual([]);
  expect(warning).toBeNull();
});

test('clears the label when the run did review', async () => {
  const { client, added, removed } = clientRecording();

  const warning = await syncUnreviewedLabel(client, false);

  expect(removed).toEqual([UNREVIEWED_LABEL]);
  expect(added).toEqual([]);
  expect(warning).toBeNull();
});

test('removing a label that was never there is the ordinary case, not a warning', async () => {
  // Every clean pull request takes this path. A warning here would fire on
  // almost every run and train people to ignore the ones that matter.
  const { client } = clientRecording({ remove: () => Promise.reject(httpError(404)) });

  expect(await syncUnreviewedLabel(client, false)).toBeNull();
});

test('a real failure to remove warns rather than passing silently', async () => {
  const { client } = clientRecording({ remove: () => Promise.reject(httpError(500)) });

  expect(await syncUnreviewedLabel(client, false)).toMatch(/label/i);
});

test('a missing permission to label warns and never throws', async () => {
  const { client } = clientRecording({ add: () => Promise.reject(httpError(403)) });

  const warning = await syncUnreviewedLabel(client, true);

  expect(warning).toMatch(/label/i);
});

test('a 404 on adding is a real failure, unlike a 404 on removing', async () => {
  // Nothing about adding a label is idempotently absent, so a 404 there means
  // the pull request itself could not be found.
  const { client } = clientRecording({ add: () => Promise.reject(httpError(404)) });

  expect(await syncUnreviewedLabel(client, true)).toMatch(/label/i);
});

test('a rejection that is not an http error still cannot escape', async () => {
  const { client } = clientRecording({ remove: () => Promise.reject(new Error('socket closed')) });

  expect(await syncUnreviewedLabel(client, false)).toMatch(/socket closed/);
});
