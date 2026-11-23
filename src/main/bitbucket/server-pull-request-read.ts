import type {
  BitbucketPullRequestDetail,
  BitbucketPullRequestDiff,
  BitbucketPullRequestState,
  BitbucketPullRequestStateFilter,
  BitbucketPullRequestSummary,
  BitbucketPullRequestTarget,
  BitbucketRepositoryTarget,
  BitbucketReviewResult,
  BitbucketReviewUser
} from '../../shared/bitbucket/bitbucket-pull-request-review'
import { diffReadLimit, toDiffReply } from './pull-request-diff-reply'
import type { RawBitbucketServerPullRequest } from './server-pull-request-mappers'
import {
  getBitbucketServerJson,
  getBitbucketServerText,
  type BitbucketServerQuery
} from './server-review-request'

const LIST_PAGE_SIZE = 50

export type RawBitbucketServerUser = {
  name?: string
  slug?: string
  displayName?: string
}

type RawServerReviewPullRequest = Omit<RawBitbucketServerPullRequest, 'reviewers'> & {
  description?: string
  createdDate?: number
  draft?: boolean
  author?: { user?: RawBitbucketServerUser }
  reviewers?: { user?: RawBitbucketServerUser; approved?: boolean; status?: string }[]
  properties?: { commentCount?: number }
}

type RawServerPage<T> = { values?: T[]; isLastPage?: boolean; nextPageStart?: number | null }

export function mapBitbucketServerUser(
  raw: RawBitbucketServerUser | null | undefined
): BitbucketReviewUser | null {
  const id = raw?.name ?? raw?.slug ?? null
  const displayName = raw?.displayName?.trim() || id
  return displayName ? { id, displayName } : null
}

/** Data Center sends epoch milliseconds. */
export function bitbucketServerDate(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? new Date(value).toISOString() : ''
}

function mapState(state: string | null | undefined): BitbucketPullRequestState {
  const lower = typeof state === 'string' ? state.trim().toLowerCase() : ''
  return lower === 'merged' || lower === 'declined' ? lower : 'open'
}

function mapSummary(raw: RawServerReviewPullRequest): BitbucketPullRequestSummary | null {
  const url = raw.links?.self?.[0]?.href
  if (typeof raw.id !== 'number' || !url) {
    return null
  }
  return {
    id: raw.id,
    title: raw.title ?? '',
    state: mapState(raw.state),
    author: mapBitbucketServerUser(raw.author?.user),
    sourceBranch: raw.fromRef?.displayId ?? '',
    destinationBranch: raw.toRef?.displayId ?? '',
    url,
    updatedAt: bitbucketServerDate(raw.updatedDate)
  }
}

function pullRequestPath(target: BitbucketPullRequestTarget): string {
  return `/pull-requests/${target.id}`
}

export async function listBitbucketServerPullRequests(
  repo: BitbucketRepositoryTarget,
  state: BitbucketPullRequestStateFilter,
  limit: number
): Promise<BitbucketReviewResult<BitbucketPullRequestSummary[]>> {
  // Data Center has no superseded state.
  if (state === 'superseded') {
    return { ok: true, value: [] }
  }
  const pullRequests: BitbucketPullRequestSummary[] = []
  for (let start = 0; pullRequests.length < limit;) {
    const query: BitbucketServerQuery = [
      ['state', state.toUpperCase()],
      ['order', 'NEWEST'],
      ['limit', String(Math.min(limit, LIST_PAGE_SIZE))],
      ['start', String(start)]
    ]
    const reply = await getBitbucketServerJson<RawServerPage<RawServerReviewPullRequest>>(
      repo,
      '/pull-requests',
      query
    )
    if (!reply.ok) {
      return reply
    }
    const values = reply.value.values ?? []
    pullRequests.push(...values.flatMap((raw) => mapSummary(raw) ?? []))
    const next = reply.value.nextPageStart
    if (reply.value.isLastPage !== false || typeof next !== 'number' || next <= start) {
      break
    }
    start = next
  }
  return { ok: true, value: pullRequests.slice(0, limit) }
}

export async function getBitbucketServerPullRequestDetail(
  target: BitbucketPullRequestTarget
): Promise<BitbucketReviewResult<BitbucketPullRequestDetail>> {
  const reply = await getBitbucketServerJson<RawServerReviewPullRequest>(
    target,
    pullRequestPath(target)
  )
  if (!reply.ok) {
    return reply
  }
  const raw = reply.value
  const summary = mapSummary(raw)
  if (!summary) {
    return {
      ok: false,
      code: 'bitbucket_request_failed',
      error: 'Bitbucket returned a pull request Orca could not read.'
    }
  }
  return {
    ok: true,
    value: {
      ...summary,
      description: raw.description ?? '',
      createdAt: bitbucketServerDate(raw.createdDate),
      headSha: raw.fromRef?.latestCommit ?? null,
      baseSha: raw.toRef?.latestCommit ?? null,
      draft: raw.draft === true,
      reviewers: (raw.reviewers ?? []).flatMap((reviewer) => {
        const user = mapBitbucketServerUser(reviewer.user)
        const approved = reviewer.approved === true || reviewer.status === 'APPROVED'
        return user ? [{ ...user, approved }] : []
      }),
      commentCount: raw.properties?.commentCount ?? 0
    }
  }
}

export async function getBitbucketServerPullRequestDiff(
  target: BitbucketPullRequestTarget,
  path?: string
): Promise<BitbucketReviewResult<BitbucketPullRequestDiff>> {
  const reply = await getBitbucketServerText(
    target,
    `${pullRequestPath(target)}.diff`,
    diffReadLimit(path)
  )
  return reply.ok ? { ok: true, value: toDiffReply(reply.value, path) } : reply
}
