// What changed lately in one Bitbucket Cloud repository's pull requests, for the host's trigger
// checks: new comments from the repository's activity feed, and the open pull requests that ask an
// account to review. A pull request's `updated_on` does not move with every comment, so it is no cursor.
import type {
  BitbucketPullRequestSummary,
  BitbucketRepositoryTarget,
  BitbucketReviewResult,
  BitbucketReviewUser
} from '../../shared/bitbucket/bitbucket-pull-request-review'
import { mapBitbucketReviewUser, type RawBitbucketReviewUser } from './cloud-pull-request-read'
import { getBitbucketCloudJson, type BitbucketCloudQuery } from './cloud-review-request'

const PAGE_SIZE = 50
const MAX_ACTIVITY_PAGES = 4
const MAX_OPEN_PAGES = 4

export type BitbucketRecentComment = {
  id: number
  pullRequestId: number
  pullRequestTitle: string
  author: BitbucketReviewUser | null
  body: string
  createdAt: string
}

export type BitbucketRecentComments = {
  /** Oldest first. */
  comments: BitbucketRecentComment[]
  /** The newest comment id the feed showed; null when it showed none. */
  newestId: number | null
  /** More new comments exist than one check reads; the oldest of them were skipped. */
  skipped: boolean
}

type RawActivity = {
  comment?: {
    id?: number
    deleted?: boolean | null
    content?: { raw?: string | null } | null
    user?: RawBitbucketReviewUser | null
    created_on?: string | null
  } | null
  pull_request?: { id?: number; title?: string | null } | null
}

function recentComment(raw: RawActivity): BitbucketRecentComment | null {
  const comment = raw.comment
  const pullRequestId = raw.pull_request?.id
  if (typeof comment?.id !== 'number' || typeof pullRequestId !== 'number' || comment.deleted) {
    return null
  }
  return {
    id: comment.id,
    pullRequestId,
    pullRequestTitle: raw.pull_request?.title ?? '',
    author: mapBitbucketReviewUser(comment.user),
    body: comment.content?.raw ?? '',
    createdAt: comment.created_on ?? ''
  }
}

// Only the feed's own page cursor is taken from `next`; the request URL is always built here, so a
// reply can never send the credential elsewhere.
function nextPageCursor(next: string | undefined): string | null {
  try {
    return next ? new URL(next).searchParams.get('ctx') : null
  } catch {
    return null
  }
}

/**
 * The repository's pull request comments with an id above `afterId`, oldest first. With `afterId`
 * null nothing is listed: the caller only learns where the feed stands now.
 */
export async function listBitbucketCloudRecentComments(
  repo: BitbucketRepositoryTarget,
  afterId: number | null
): Promise<BitbucketReviewResult<BitbucketRecentComments>> {
  const found = new Map<number, BitbucketRecentComment>()
  let newestId: number | null = null
  let cursor: string | null = null
  for (let page = 1; page <= MAX_ACTIVITY_PAGES; page += 1) {
    const query: BitbucketCloudQuery = [
      ['pagelen', String(PAGE_SIZE)],
      ...(cursor ? ([['ctx', cursor]] as const) : [])
    ]
    const reply = await getBitbucketCloudJson<{ values?: RawActivity[]; next?: string }>(
      repo,
      '/pullrequests/activity',
      query
    )
    if (!reply.ok) {
      return reply
    }
    const comments = (reply.value.values ?? []).flatMap((raw) => recentComment(raw) ?? [])
    const ids = comments.map((comment) => comment.id)
    newestId = Math.max(newestId ?? 0, ...ids) || newestId
    for (const comment of comments) {
      if (afterId !== null && comment.id > afterId) {
        found.set(comment.id, comment)
      }
    }
    cursor = nextPageCursor(reply.value.next)
    // An edited old comment can sit above newer ones, so a page is read whole before stopping.
    const reachedSeen = afterId === null || ids.some((id) => id <= afterId)
    if (reachedSeen || !cursor) {
      return {
        ok: true,
        value: {
          comments: [...found.values()].sort((a, b) => a.id - b.id),
          newestId,
          skipped: false
        }
      }
    }
  }
  return {
    ok: true,
    value: { comments: [...found.values()].sort((a, b) => a.id - b.id), newestId, skipped: true }
  }
}

type RawOpenPullRequest = {
  id?: number
  title?: string | null
  updated_on?: string | null
  author?: RawBitbucketReviewUser | null
  reviewers?: RawBitbucketReviewUser[] | null
  source?: { branch?: { name?: string } }
  destination?: { branch?: { name?: string } }
}

/** The open pull requests that list `accountId` as a reviewer. */
export async function listBitbucketCloudReviewRequests(
  repo: BitbucketRepositoryTarget,
  accountId: string
): Promise<BitbucketReviewResult<BitbucketPullRequestSummary[]>> {
  const requested: BitbucketPullRequestSummary[] = []
  for (let page = 1; page <= MAX_OPEN_PAGES; page += 1) {
    const reply = await getBitbucketCloudJson<{ values?: RawOpenPullRequest[]; next?: string }>(
      repo,
      '/pullrequests',
      [
        ['state', 'OPEN'],
        ['sort', '-updated_on'],
        // The list leaves reviewers out unless asked.
        ['fields', '+values.reviewers'],
        ['pagelen', String(PAGE_SIZE)],
        ['page', String(page)]
      ]
    )
    if (!reply.ok) {
      return reply
    }
    const values = reply.value.values ?? []
    for (const raw of values) {
      const asked = (raw.reviewers ?? []).some(
        (reviewer) => mapBitbucketReviewUser(reviewer)?.id === accountId
      )
      if (asked && typeof raw.id === 'number') {
        requested.push({
          id: raw.id,
          title: raw.title ?? '',
          state: 'open',
          author: mapBitbucketReviewUser(raw.author),
          sourceBranch: raw.source?.branch?.name ?? '',
          destinationBranch: raw.destination?.branch?.name ?? '',
          url: bitbucketCloudPullRequestUrl(repo, raw.id),
          updatedAt: raw.updated_on ?? ''
        })
      }
    }
    if (!reply.value.next || values.length === 0) {
      break
    }
  }
  return { ok: true, value: requested }
}

/** Built from the repository and number alone, never from a link Bitbucket sent. */
export function bitbucketCloudPullRequestUrl(repo: BitbucketRepositoryTarget, id: number): string {
  return `https://bitbucket.org/${repo.workspace}/${repo.repoSlug}/pull-requests/${id}`
}
