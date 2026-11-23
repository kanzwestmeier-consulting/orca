export type BitbucketRepositoryTarget = {
  workspace: string
  repoSlug: string
}

export type BitbucketPullRequestTarget = BitbucketRepositoryTarget & { id: number }

export const BITBUCKET_PULL_REQUEST_STATES = ['open', 'merged', 'declined', 'superseded'] as const
export type BitbucketPullRequestState = (typeof BITBUCKET_PULL_REQUEST_STATES)[number]

export const BITBUCKET_PULL_REQUEST_STATE_FILTERS = [
  ...BITBUCKET_PULL_REQUEST_STATES,
  'all'
] as const
export type BitbucketPullRequestStateFilter = (typeof BITBUCKET_PULL_REQUEST_STATE_FILTERS)[number]

export type BitbucketReviewUser = {
  /** Stable account id when Bitbucket sends one; display names are not unique. */
  id: string | null
  displayName: string
}

export type BitbucketPullRequestSummary = {
  id: number
  title: string
  state: BitbucketPullRequestState
  author: BitbucketReviewUser | null
  sourceBranch: string
  destinationBranch: string
  url: string
  updatedAt: string
}

export type BitbucketPullRequestReviewer = BitbucketReviewUser & { approved: boolean }

export type BitbucketPullRequestDetail = BitbucketPullRequestSummary & {
  description: string
  createdAt: string
  headSha: string | null
  baseSha: string | null
  draft: boolean
  reviewers: BitbucketPullRequestReviewer[]
  commentCount: number
}

export const BITBUCKET_COMMENT_SIDES = ['new', 'old'] as const
/** `new` is a line of the changed file; `old` is a removed line of the previous version. */
export type BitbucketCommentSide = (typeof BITBUCKET_COMMENT_SIDES)[number]

export type BitbucketCommentAnchor = {
  path: string
  line: number
  side: BitbucketCommentSide
}

export type BitbucketPullRequestComment = {
  id: number
  parentId: number | null
  author: BitbucketReviewUser | null
  body: string
  createdAt: string
  updatedAt: string
  deleted: boolean
  /** A file comment has a path and no line. */
  inline: { path: string; line: number | null; side: BitbucketCommentSide } | null
  url: string | null
}

export type BitbucketPullRequestDiff = {
  diff: string
  /** The reply holds only the first part; ask for one file with `path`, or diff locally. */
  truncated: boolean
}

export type BitbucketPullRequestCommentList = {
  comments: BitbucketPullRequestComment[]
  truncated: boolean
}

export type BitbucketReviewFailureCode =
  | 'bitbucket_not_connected'
  | 'bitbucket_auth_rejected'
  | 'bitbucket_forbidden'
  | 'bitbucket_not_found'
  | 'bitbucket_rate_limited'
  | 'bitbucket_timeout'
  | 'bitbucket_request_failed'

export type BitbucketReviewFailure = {
  ok: false
  code: BitbucketReviewFailureCode
  error: string
}

export type BitbucketReviewResult<T> = { ok: true; value: T } | BitbucketReviewFailure
