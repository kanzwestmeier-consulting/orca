// What changed lately in one Bitbucket Data Center repository's pull requests, for the host's
// trigger checks. Data Center has no repository-wide comment feed, so one request lists the open pull
// requests and their comments are read pull request by pull request: first those whose comment
// count or update time moved, then the ones not read for the longest. Neither signal is documented
// to move with every comment, so nothing depends on it alone.
import type {
  BitbucketPullRequestSummary,
  BitbucketRepositoryTarget,
  BitbucketReviewResult
} from '../../shared/bitbucket/bitbucket-pull-request-review'
import type { BitbucketCommentLook } from './bitbucket-comment-look'
import type { BitbucketRepositoryCheckState } from './bitbucket-trigger-state'
import type { BitbucketRecentComment } from './cloud-pull-request-activity'
import { listBitbucketServerPullRequestComments } from './server-pull-request-comments'
import {
  bitbucketServerDate,
  mapBitbucketServerUser,
  type RawBitbucketServerUser
} from './server-pull-request-read'
import { getBitbucketServerJson, getBitbucketServerRootJson } from './server-review-request'

const PAGE_SIZE = 50
const MAX_OPEN_PAGES = 4
// Each pull request read costs a request, so a busy repository is caught up over several checks.
const MAX_PULL_REQUESTS_PER_LOOK = 5
// Read even when nothing seems to have moved, so a comment the list does not show is still found.
const QUIET_PULL_REQUESTS_PER_LOOK = 2
// The server's clock stamps comments and this host's marks the first look; they may disagree a little.
const CLOCK_SKEW_MS = 2 * 60_000

type RawOpenPullRequest = {
  id?: number
  title?: string
  updatedDate?: number
  author?: { user?: RawBitbucketServerUser }
  fromRef?: { displayId?: string }
  toRef?: {
    displayId?: string
    repository?: { slug?: string; project?: { key?: string } }
  }
  properties?: { commentCount?: number }
}

type RawPage<T> = { values?: T[]; isLastPage?: boolean; nextPageStart?: number | null }

type OpenPullRequest = RawOpenPullRequest & { id: number }

/** Built from the connected server, the repository and the number, never from a link the server sent. */
export function bitbucketServerPullRequestUrl(
  baseUrl: string,
  repo: Pick<BitbucketRepositoryTarget, 'workspace' | 'repoSlug'>,
  id: number
): string {
  const owner = repo.workspace.startsWith('~')
    ? `users/${encodeURIComponent(repo.workspace.slice(1))}`
    : `projects/${encodeURIComponent(repo.workspace)}`
  return `${baseUrl}/${owner}/repos/${encodeURIComponent(repo.repoSlug)}/pull-requests/${id}`
}

// The server's own spelling of the project key when it matches the rule's: older servers only open
// a pull request page under the key's exact case.
function pullRequestUrl(
  baseUrl: string,
  repo: BitbucketRepositoryTarget,
  pullRequest: OpenPullRequest
): string {
  const key = pullRequest.toRef?.repository?.project?.key
  const workspace = key && key.toLowerCase() === repo.workspace.toLowerCase() ? key : repo.workspace
  return bitbucketServerPullRequestUrl(baseUrl, { ...repo, workspace }, pullRequest.id)
}

async function readOpenPullRequests(
  ask: (start: number) => Promise<BitbucketReviewResult<RawPage<RawOpenPullRequest>>>
): Promise<BitbucketReviewResult<{ open: OpenPullRequest[]; complete: boolean }>> {
  const open: OpenPullRequest[] = []
  let start = 0
  for (let page = 1; page <= MAX_OPEN_PAGES; page += 1) {
    const reply = await ask(start)
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

const markOf = (pullRequest: OpenPullRequest) =>
  `${pullRequest.properties?.commentCount ?? 0}:${pullRequest.updatedDate ?? 0}`

/**
 * The repository's new pull request comments. The first look only marks where each open pull
 * request stands; later looks read the comments of a few pull requests each.
 */
export async function lookAtBitbucketServerComments(
  repo: BitbucketRepositoryTarget,
  baseUrl: string,
  saved: BitbucketRepositoryCheckState,
  now: number
): Promise<BitbucketReviewResult<BitbucketCommentLook>> {
  const listed = await readOpenPullRequests((start) =>
    getBitbucketServerJson(repo, '/pull-requests', [
      ['state', 'OPEN'],
      ['order', 'NEWEST'],
      ['limit', String(PAGE_SIZE)],
      ['start', String(start)]
    ])
  )
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
  const isMoved = (pullRequest: OpenPullRequest) =>
    known[String(pullRequest.id)]?.mark !== markOf(pullRequest)
  const moved = open
    .filter(isMoved)
    // Longest-waiting first, so a busy pull request never starves the others.
    .sort((a, b) => (a.updatedDate ?? 0) - (b.updatedDate ?? 0))
    .slice(0, MAX_PULL_REQUESTS_PER_LOOK)
  const quiet = open
    .filter((pullRequest) => !isMoved(pullRequest))
    .sort((a, b) => (known[String(a.id)]?.readAt ?? 0) - (known[String(b.id)]?.readAt ?? 0))
    .slice(0, Math.max(0, QUIET_PULL_REQUESTS_PER_LOOK - moved.length))
  const comments: BitbucketRecentComment[] = []
  const read: { pullRequest: OpenPullRequest; newestId: number }[] = []
  for (const pullRequest of [...moved, ...quiet]) {
    // Every page, so nothing rests on the order the server lists activity in.
    const reply = await listBitbucketServerPullRequestComments({ ...repo, id: pullRequest.id })
    if (!reply.ok) {
      return reply
    }
    const seenId = known[String(pullRequest.id)]?.commentId ?? 0
    const all = reply.value.comments
    read.push({ pullRequest, newestId: Math.max(seenId, ...all.map((comment) => comment.id)) })
    for (const comment of all) {
      if (comment.id > seenId && (Date.parse(comment.createdAt) || 0) > since) {
        comments.push({
          id: comment.id,
          pullRequestId: pullRequest.id,
          pullRequestTitle: pullRequest.title ?? '',
          pullRequestUrl: pullRequestUrl(baseUrl, repo, pullRequest),
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
          ...known[key],
          mark: known[key]?.mark ?? '',
          commentId: Math.max(known[key]?.commentId ?? 0, comment.id)
        }
      },
      finish: () => {
        for (const { pullRequest, newestId } of read) {
          known[String(pullRequest.id)] = {
            mark: markOf(pullRequest),
            commentId: newestId,
            readAt: now
          }
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

/**
 * The repository's open pull requests that ask the connected account to review. The server answers
 * for the token's own user, so the account's name is never needed.
 */
export async function listBitbucketServerReviewRequests(
  repo: BitbucketRepositoryTarget,
  baseUrl: string
): Promise<BitbucketReviewResult<BitbucketPullRequestSummary[]>> {
  const listed = await readOpenPullRequests((start) =>
    getBitbucketServerRootJson(repo, '/dashboard/pull-requests', [
      ['role', 'REVIEWER'],
      ['state', 'OPEN'],
      ['limit', String(PAGE_SIZE)],
      ['start', String(start)]
    ])
  )
  if (!listed.ok) {
    return listed
  }
  const here = (pullRequest: OpenPullRequest) => {
    const repository = pullRequest.toRef?.repository
    return (
      repository?.project?.key?.toLowerCase() === repo.workspace.toLowerCase() &&
      repository.slug?.toLowerCase() === repo.repoSlug.toLowerCase()
    )
  }
  return {
    ok: true,
    value: listed.value.open.filter(here).map((pullRequest) => ({
      id: pullRequest.id,
      title: pullRequest.title ?? '',
      state: 'open' as const,
      author: mapBitbucketServerUser(pullRequest.author?.user),
      sourceBranch: pullRequest.fromRef?.displayId ?? '',
      destinationBranch: pullRequest.toRef?.displayId ?? '',
      url: pullRequestUrl(baseUrl, repo, pullRequest),
      updatedAt: bitbucketServerDate(pullRequest.updatedDate)
    }))
  }
}
