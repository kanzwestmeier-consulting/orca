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
import { BITBUCKET_PULL_REQUEST_STATES } from '../../shared/bitbucket/bitbucket-pull-request-review'
import {
  getBitbucketCloudJson,
  getBitbucketCloudText,
  type BitbucketCloudQuery
} from './cloud-review-request'
import type { RawBitbucketPullRequest } from './pull-request-mappers'
import { selectDiffFileSection } from './pull-request-diff-file-section'

// Bitbucket Cloud caps pull request pages at 50.
const LIST_PAGE_SIZE = 50
// One reply must fit a remote runtime's WebSocket frame.
export const MAX_DIFF_REPLY_CHARS = 256 * 1024
const MAX_DIFF_SCAN_CHARS = 8 * 1024 * 1024

export type RawBitbucketReviewUser = {
  display_name?: string | null
  nickname?: string | null
  account_id?: string | null
  uuid?: string | null
}

type RawBitbucketReviewPullRequest = RawBitbucketPullRequest & {
  description?: string | null
  created_on?: string | null
  draft?: boolean | null
  comment_count?: number | null
  author?: RawBitbucketReviewUser | null
  reviewers?: RawBitbucketReviewUser[] | null
  participants?: { user?: RawBitbucketReviewUser | null; approved?: boolean | null }[] | null
  destination?: RawBitbucketPullRequest['destination'] & { commit?: { hash?: string } | null }
}

export function mapBitbucketReviewUser(
  raw: RawBitbucketReviewUser | null | undefined
): BitbucketReviewUser | null {
  const displayName = raw?.display_name?.trim() || raw?.nickname?.trim()
  const id = raw?.account_id ?? raw?.uuid ?? null
  return displayName || id ? { id, displayName: displayName || id || '' } : null
}

function mapState(state: string | null | undefined): BitbucketPullRequestState {
  const lower = state?.trim().toLowerCase()
  return BITBUCKET_PULL_REQUEST_STATES.find((known) => known === lower) ?? 'open'
}

function mapSummary(raw: RawBitbucketReviewPullRequest): BitbucketPullRequestSummary | null {
  if (typeof raw.id !== 'number' || !raw.links?.html?.href) {
    return null
  }
  return {
    id: raw.id,
    title: raw.title ?? '',
    state: mapState(raw.state),
    author: mapBitbucketReviewUser(raw.author),
    sourceBranch: raw.source?.branch?.name ?? '',
    destinationBranch: raw.destination?.branch?.name ?? '',
    url: raw.links.html.href,
    updatedAt: raw.updated_on ?? ''
  }
}

function mapDetail(raw: RawBitbucketReviewPullRequest): BitbucketPullRequestDetail | null {
  const summary = mapSummary(raw)
  if (!summary) {
    return null
  }
  const approvedIds = new Set(
    (raw.participants ?? [])
      .filter((participant) => participant.approved === true)
      .map((participant) => mapBitbucketReviewUser(participant.user)?.id)
  )
  return {
    ...summary,
    description: raw.description ?? '',
    createdAt: raw.created_on ?? '',
    headSha: raw.source?.commit?.hash?.trim() || null,
    baseSha: raw.destination?.commit?.hash?.trim() || null,
    draft: raw.draft === true,
    reviewers: (raw.reviewers ?? []).flatMap((reviewer) => {
      const user = mapBitbucketReviewUser(reviewer)
      return user ? [{ ...user, approved: user.id !== null && approvedIds.has(user.id) }] : []
    }),
    commentCount: raw.comment_count ?? 0
  }
}

const UNREADABLE_REPLY = {
  ok: false,
  code: 'bitbucket_request_failed',
  error: 'Bitbucket returned a pull request Orca could not read.'
} as const

function pullRequestPath(target: BitbucketPullRequestTarget): string {
  return `/pullrequests/${target.id}`
}

export async function listBitbucketCloudPullRequests(
  repo: BitbucketRepositoryTarget,
  state: BitbucketPullRequestStateFilter,
  limit: number
): Promise<BitbucketReviewResult<BitbucketPullRequestSummary[]>> {
  const states = state === 'all' ? BITBUCKET_PULL_REQUEST_STATES : [state]
  const pullRequests: BitbucketPullRequestSummary[] = []
  // Pages are requested by number so a reply can never redirect the credential to another URL.
  for (let page = 1; pullRequests.length < limit; page += 1) {
    const query: BitbucketCloudQuery = [
      ...states.map((entry) => ['state', entry.toUpperCase()] as const),
      ['sort', '-updated_on'],
      ['pagelen', String(Math.min(limit, LIST_PAGE_SIZE))],
      ['page', String(page)]
    ]
    const reply = await getBitbucketCloudJson<{
      values?: RawBitbucketReviewPullRequest[]
      next?: string
    }>(repo, '/pullrequests', query)
    if (!reply.ok) {
      return reply
    }
    const values = reply.value.values ?? []
    pullRequests.push(...values.flatMap((raw) => mapSummary(raw) ?? []))
    if (!reply.value.next || values.length === 0) {
      break
    }
  }
  return { ok: true, value: pullRequests.slice(0, limit) }
}

export async function getBitbucketCloudPullRequestDetail(
  target: BitbucketPullRequestTarget
): Promise<BitbucketReviewResult<BitbucketPullRequestDetail>> {
  const reply = await getBitbucketCloudJson<RawBitbucketReviewPullRequest>(
    target,
    pullRequestPath(target)
  )
  if (!reply.ok) {
    return reply
  }
  const detail = mapDetail(reply.value)
  return detail ? { ok: true, value: detail } : UNREADABLE_REPLY
}

export async function getBitbucketCloudPullRequestDiff(
  target: BitbucketPullRequestTarget,
  path?: string
): Promise<BitbucketReviewResult<BitbucketPullRequestDiff>> {
  // One file is cut out of the whole diff here: the pull request diff endpoint takes no path.
  const reply = await getBitbucketCloudText(
    target,
    `${pullRequestPath(target)}/diff`,
    path ? MAX_DIFF_SCAN_CHARS : MAX_DIFF_REPLY_CHARS
  )
  if (!reply.ok) {
    return reply
  }
  const diff = path ? selectDiffFileSection(reply.value.text, path) : reply.value.text
  return {
    ok: true,
    value: {
      diff: diff.slice(0, MAX_DIFF_REPLY_CHARS),
      truncated: reply.value.truncated || diff.length > MAX_DIFF_REPLY_CHARS
    }
  }
}
