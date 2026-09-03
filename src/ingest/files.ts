/**
 * Translation between the pull request files API and the action's own diff
 * model. Keeping this a pure function means budgeting and prompt assembly can
 * be tested without an API client.
 */
import type { DiffFile, DiffFileStatus } from './budget.js';

export interface ApiDiffFile {
  filename: string;
  status: DiffFileStatus;
  additions: number;
  deletions: number;
  /** The API omits this for binary files and for very large patches. */
  patch?: string;
}

export function toDiffFiles(apiFiles: readonly ApiDiffFile[]): DiffFile[] {
  return apiFiles.map((file) => {
    const mapped: DiffFile = {
      path: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
    };

    // The key stays absent rather than set to undefined, so "no patch" is one
    // condition downstream instead of two.
    return file.patch === undefined ? mapped : { ...mapped, patch: file.patch };
  });
}
