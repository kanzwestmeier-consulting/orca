// What changed lately in one Bitbucket Data Center repository's pull requests, for the host's
// trigger checks. Data Center has no repository-wide comment feed, so one request lists the open pull
// requests and only those whose comment count or update time moved are asked for their activity.
import type {
  BitbucketPullRequestSummary,
  BitbucketRepositoryTarget,
  BitbucketReviewResult
} from '../../shared/bitbucket/bitbucket-pull-request-review'
import type { BitbucketCommentLook } from './bitbucket-comment-look'
import type { BitbucketRepositoryCheckState } from './bitbucket-trigger-state'
import type { BitbucketRecentComment } from './cloud-pull-request-activity'
import {
  flattenBitbucketServerActivities,
  type RawBitbucketServerActivity
} from './server-pull-request-comments'
import {
  bitbucketServerDate,
  mapBitbucketServerUser,
  type RawBitbucketServerUser
} from './server-pull-request-read'
import { getBitbucketServerJson } from './server-review-request'

const PAGE_SIZE = 50
const MAX_OPEN_PAGES = 4
const ACTIVITY_PAGE_SIZE = 100
// Each changed pull request costs a request, so a busy repository is caught up over several checks.
const MAX_PULL_REQUESTS_PER_LOOK = 5
// The server's clock stamps comments and this host's marks the first look; they may disagree a little.
const CLOCK_SKEW_MS = 2 * 60_000

type RawOpenPullRequest = {
  id?: number
  title?: string
  updatedDate?: number
  author?: { user?: RawBitbucketServerUser }
  reviewers?: { user?: RawBitbucketServerUser }[]
  fromRef?: { displayId?: string }
  toRef?: { displayId?: string }
  properties?: { commentCount?: number }
}

type RawPage<T> = { values?: T[]; isLastPage?: boolean; nextPageStart?: number | null }

type OpenPullRequest = RawOpenPullRequest & { id: number }

/** Built from the connected server, the repository and the number, never from a link the server sent. */
export function bitbucketServerPullRequestUrl(
  baseUrl: string,
  repo: BitbucketRepositoryTarget,
  id: number
): string {
  const owner = repo.workspace.startsWith('~')
    ? `users/${encodeURIComponent(repo.workspace.slice(1))}`
    : `projects/${encodeURIComponent(repo.workspace)}`
  return `${baseUrl}/${owner}/repos/${encodeURIComponent(repo.repoSlug)}/pull-requests/${id}`
}

async function listOpenPullRequests(
  repo: BitbucketRepositoryTarget
): Promise<BitbucketReviewResult<{ open: OpenPullRequest[]; complete: boolean }>> {
  const open: OpenPullRequest[] = []
  let start = 0
  for (let page = 1; page <= MAX_OPEN_PAGES; page += 1) {
    const reply = await getBitbucketServerJson<RawPage<RawOpenPullRequest>>(
      repo,
      '/pull-requests',
      [
        ['state', 'OPEN'],
        ['order', 'NEWEST'],
        ['limit', String(PAGE_SIZE)],
        ['start', String(start)]
      ]
    )
    if (!reply.ok) {
      return reply
    }
    for (const raw of reply.value.values ?? []) {
      if (typeof raw.id === 'number') {
        open.push({ ...raw, id: raw.id })
      }
    }
    const next = reply.value.nextPageStart
    if (reply.value.isLastPage !== false || typeof next !== 'number' || next <= start) {
      return { ok: true, value: { open, complete: true } }
    }
    start = next
  }
  return { ok: true, value: { open, complete: false } }
}

// A new comment raises the count; an edit or a reply the count misses still moves the update time.
const markOf = (pullRequest: OpenPullRequest) =>
  `${pullRequest.properties?.commentCount ?? 0}:${pullRequest.updatedDate ?? 0}`

/**
 * The repository's new pull request comments. The first look only marks where each open pull
 * request stands; later looks read the activity of those that moved since.
 */
export async function lookAtBitbucketServerComments(
  repo: BitbucketRepositoryTarget,
  baseUrl: string,
  saved: BitbucketRepositoryCheckState,
  now: number
): Promise<BitbucketReviewResult<BitbucketCommentLook>> {
  const listed = await listOpenPullRequests(repo)
  if (!listed.ok) {
    return listed
  }
  const { open, complete } = listed.value
  const known = saved.pulls
  if (saved.since === undefined || known === undefined) {
    return {
      ok: true,
      value: {
        comments: [],
        handled: () => undefined,
        finish: () => {
          saved.since = now
          saved.pulls = Object.fromEntries(
            open.map((pullRequest) => [
              String(pullRequest.id),
              { mark: markOf(pullRequest), commentId: 0 }
            ])
          )
        }
      }
    }
  }
  const since = saved.since - CLOCK_SKEW_MS
  const moved = open
    .filter((pullRequest) => known[String(pullRequest.id)]?.mark !== markOf(pullRequest))
    // Longest-waiting first, so a busy pull request never starves the others.
    .sort((a, b) => (a.updatedDate ?? 0) - (b.updatedDate ?? 0))
    .slice(0, MAX_PULL_REQUESTS_PER_LOOK)
  const comments: BitbucketRecentComment[] = []
  const read: { pullRequest: OpenPullRequest; newestId: number }[] = []
  for (const pullRequest of moved) {
    // Newest first, so one page holds what was written since the last look.
    const reply = await getBitbucketServerJson<RawPage<RawBitbucketServerActivity>>(
      repo,
      `/pull-requests/${pullRequest.id}/activities`,
      [['limit', String(ACTIVITY_PAGE_SIZE)]]
    )
    if (!reply.ok) {
      return reply
    }
    const seenId = known[String(pullRequest.id)]?.commentId ?? 0
    const all = flattenBitbucketServerActivities(reply.value.values ?? [])
    read.push({ pullRequest, newestId: Math.max(seenId, ...all.map((comment) => comment.id)) })
    for (const comment of all) {
      // A reply is nested under an old thread, so every comment is checked, not only top-level ones.
      if (comment.id > seenId && (Date.parse(comment.createdAt) || 0) > since) {
        comments.push({
          id: comment.id,
          pullRequestId: pullRequest.id,
          pullRequestTitle: pullRequest.title ?? '',
          pullRequestUrl: bitbucketServerPullRequestUrl(baseUrl, repo, pullRequest.id),
          author: comment.author,
          body: comment.body,
          createdAt: comment.createdAt
        })
      }
    }
  }
  return {
    ok: true,
    value: {
      comments: comments.sort((a, b) => a.id - b.id),
      handled: (comment) => {
        const key = String(comment.pullRequestId)
        // The old mark stays, so a look that stops early reads this pull request again.
        known[key] = {
          mark: known[key]?.mark ?? '',
          commentId: Math.max(known[key]?.commentId ?? 0, comment.id)
        }
      },
      finish: () => {
        for (const { pullRequest, newestId } of read) {
          known[String(pullRequest.id)] = { mark: markOf(pullRequest), commentId: newestId }
        }
        if (complete) {
          const stillOpen = new Set(open.map((pullRequest) => String(pullRequest.id)))
          for (const key of Object.keys(known)) {
            if (!stillOpen.has(key)) {
              delete known[key]
            }
          }
        }
      }
    }
  }
}

/** The open pull requests that list `account` (a user name) as a reviewer. */
export async function listBitbucketServerReviewRequests(
  repo: BitbucketRepositoryTarget,
  baseUrl: string,
  account: string
): Promise<BitbucketReviewResult<BitbucketPullRequestSummary[]>> {
  const listed = await listOpenPullRequests(repo)
  if (!listed.ok) {
    return listed
  }
  const wanted = account.toLowerCase()
  return {
    ok: true,
    value: listed.value.open
      .filter((pullRequest) =>
        (pullRequest.reviewers ?? []).some(
          (reviewer) => mapBitbucketServerUser(reviewer.user)?.id?.toLowerCase() === wanted
        )
      )
      .map((pullRequest) => ({
        id: pullRequest.id,
        title: pullRequest.title ?? '',
        state: 'open' as const,
        author: mapBitbucketServerUser(pullRequest.author?.user),
        sourceBranch: pullRequest.fromRef?.displayId ?? '',
        destinationBranch: pullRequest.toRef?.displayId ?? '',
        url: bitbucketServerPullRequestUrl(baseUrl, repo, pullRequest.id),
        updatedAt: bitbucketServerDate(pullRequest.updatedDate)
      }))
  }
}
