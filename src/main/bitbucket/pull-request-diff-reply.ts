import type { BitbucketPullRequestDiff } from '../../shared/bitbucket/bitbucket-pull-request-review'
import type { HostedReviewTextReply } from '../source-control/hosted-review-api-request'
import { selectDiffFileSection } from './pull-request-diff-file-section'

// One reply must fit a remote runtime's WebSocket frame.
const MAX_DIFF_REPLY_CHARS = 256 * 1024
const MAX_DIFF_SCAN_CHARS = 8 * 1024 * 1024

/** How much of the diff to read: one file is cut out of the whole diff, so that reads further. */
export function diffReadLimit(path: string | undefined): number {
  return path ? MAX_DIFF_SCAN_CHARS : MAX_DIFF_REPLY_CHARS
}

export function toDiffReply(
  read: HostedReviewTextReply,
  path: string | undefined
): BitbucketPullRequestDiff {
  const diff = path ? selectDiffFileSection(read.text, path) : read.text
  return {
    diff: diff.slice(0, MAX_DIFF_REPLY_CHARS),
    truncated: read.truncated || diff.length > MAX_DIFF_REPLY_CHARS
  }
}
