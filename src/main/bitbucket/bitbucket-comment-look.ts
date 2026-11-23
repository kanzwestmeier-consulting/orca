// One look at a repository's new pull request comments, for bitbucket.mentioned rules. Bitbucket
// Cloud has a repository-wide feed; Data Center is asked pull request by pull request.
import type { BitbucketReviewResult } from '../../shared/bitbucket/bitbucket-pull-request-review'
import type { BitbucketRepositoryCheckState } from './bitbucket-trigger-state'
import type { BitbucketRecentComment, BitbucketRecentComments } from './cloud-pull-request-activity'

export type BitbucketCommentLook = {
  /** Comments not handled yet, oldest first; none on a repository's first look. */
  comments: BitbucketRecentComment[]
  /** Saves that this comment, and every one before it, never starts a run again. */
  handled(comment: BitbucketRecentComment): void
  /** Saves what the look learned, once every comment was handled. */
  finish(): void
}

/** `saved` is the repository's entry in the trigger state; the look writes its place into it. */
export async function lookAtBitbucketCloudComments(
  recent: (afterId: number | null) => Promise<BitbucketReviewResult<BitbucketRecentComments>>,
  saved: BitbucketRepositoryCheckState,
  repo: string
): Promise<BitbucketReviewResult<BitbucketCommentLook>> {
  const reply = await recent(saved.commentId ?? null)
  if (!reply.ok) {
    return reply
  }
  const { comments, newestId, skipped } = reply.value
  // The first look only marks where the repository stands: older comments never start a run.
  if (saved.commentId === undefined) {
    return {
      ok: true,
      value: {
        comments: [],
        handled: () => undefined,
        finish: () => {
          saved.commentId = newestId ?? 0
        }
      }
    }
  }
  if (skipped) {
    console.warn(`[bitbucket] skipped older new comments in ${repo}`)
  }
  return {
    ok: true,
    value: {
      comments,
      handled: (comment) => {
        saved.commentId = comment.id
      },
      finish: () => undefined
    }
  }
}
