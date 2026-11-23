import type {
  BitbucketPullRequestComment,
  BitbucketPullRequestCommentList,
  BitbucketPullRequestDetail,
  BitbucketPullRequestDiff,
  BitbucketPullRequestSummary,
  BitbucketReviewUser
} from '../../shared/bitbucket/bitbucket-pull-request-review'

const name = (user: BitbucketReviewUser | null): string => user?.displayName ?? 'unknown'

export function formatBitbucketPullRequestList(
  pullRequests: BitbucketPullRequestSummary[]
): string {
  if (pullRequests.length === 0) {
    return 'No pull requests.'
  }
  return pullRequests
    .map(
      (pr) =>
        `#${pr.id}\t${pr.state}\t${name(pr.author)}\t${pr.sourceBranch} → ${pr.destinationBranch}\t${pr.title}`
    )
    .join('\n')
}

export function formatBitbucketPullRequest(pr: BitbucketPullRequestDetail): string {
  const lines = [
    `#${pr.id} ${pr.title}`,
    `URL: ${pr.url}`,
    `State: ${pr.state}${pr.draft ? ' (draft)' : ''}`,
    `Author: ${name(pr.author)}`,
    `Branches: ${pr.sourceBranch} → ${pr.destinationBranch}`,
    `Head: ${pr.headSha ?? 'unknown'}`,
    `Reviewers: ${
      pr.reviewers
        .map((reviewer) => `${reviewer.displayName}${reviewer.approved ? ' (approved)' : ''}`)
        .join(', ') || 'none'
    }`,
    `Comments: ${pr.commentCount}`,
    `Updated: ${pr.updatedAt}`
  ]
  if (pr.description) {
    lines.push('', pr.description)
  }
  return lines.join('\n')
}

export function formatBitbucketDiff(result: BitbucketPullRequestDiff): string {
  if (!result.diff) {
    return 'No changes.'
  }
  return result.truncated
    ? `${result.diff}\n[Diff cut short. Pass --path <file> for one file, or diff the branches with git.]`
    : result.diff
}

function commentPlace(comment: BitbucketPullRequestComment): string {
  if (!comment.inline) {
    return ''
  }
  const { path, line, side } = comment.inline
  return ` — ${path}${line === null ? '' : `:${line}`}${side === 'old' ? ' (old)' : ''}`
}

export function formatBitbucketComment(comment: BitbucketPullRequestComment): string {
  return [
    `#${comment.id} ${name(comment.author)} — ${comment.createdAt}${commentPlace(comment)}`,
    ...(comment.parentId === null ? [] : [`In reply to #${comment.parentId}`]),
    comment.deleted ? '(deleted)' : comment.body
  ].join('\n')
}

export function formatBitbucketCommentList(result: BitbucketPullRequestCommentList): string {
  if (result.comments.length === 0) {
    return 'No comments.'
  }
  return [
    ...result.comments.map(formatBitbucketComment),
    ...(result.truncated ? ['[More comments exist than this command lists.]'] : [])
  ].join('\n\n')
}
