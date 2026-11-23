import type {
  BitbucketCommentAnchor,
  BitbucketPullRequestComment,
  BitbucketPullRequestCommentList,
  BitbucketPullRequestTarget,
  BitbucketReviewResult
} from '../../shared/bitbucket/bitbucket-pull-request-review'
import { bitbucketReviewFailure } from './review-request-failure'
import {
  bitbucketServerDate,
  mapBitbucketServerUser,
  type RawBitbucketServerUser
} from './server-pull-request-read'
import { getBitbucketServerJson, postBitbucketServerJson } from './server-review-request'

const ACTIVITY_PAGE_SIZE = 100
const MAX_ACTIVITY_PAGES = 10

type ServerLineType = 'ADDED' | 'REMOVED' | 'CONTEXT'

export type RawBitbucketServerAnchor = {
  path?: string
  line?: number
  lineType?: string
  fileType?: string
}

export type RawBitbucketServerComment = {
  id?: number
  text?: string
  author?: RawBitbucketServerUser
  createdDate?: number
  updatedDate?: number
  anchor?: RawBitbucketServerAnchor
  comments?: RawBitbucketServerComment[]
}

export type RawBitbucketServerActivity = {
  action?: string
  comment?: RawBitbucketServerComment
  commentAnchor?: RawBitbucketServerAnchor
}

export type RawBitbucketServerFileDiff = {
  diffs?: {
    hunks?: {
      segments?: {
        type?: string
        lines?: { source?: number; destination?: number }[]
      }[]
    }[]
  }[]
}

function mapAnchor(
  anchor: RawBitbucketServerAnchor | undefined
): BitbucketPullRequestComment['inline'] {
  if (!anchor?.path) {
    return null
  }
  return {
    path: anchor.path,
    line: typeof anchor.line === 'number' ? anchor.line : null,
    side: anchor.fileType === 'FROM' || anchor.lineType === 'REMOVED' ? 'old' : 'new'
  }
}

/** One flat, oldest-first list: Data Center nests replies under the thread's first comment. */
export function flattenBitbucketServerActivities(
  activities: readonly RawBitbucketServerActivity[]
): BitbucketPullRequestComment[] {
  const comments = new Map<number, BitbucketPullRequestComment>()
  const visit = (
    raw: RawBitbucketServerComment,
    parentId: number | null,
    inline: BitbucketPullRequestComment['inline']
  ): void => {
    if (typeof raw.id !== 'number' || comments.has(raw.id)) {
      return
    }
    comments.set(raw.id, {
      id: raw.id,
      parentId,
      author: mapBitbucketServerUser(raw.author),
      body: raw.text ?? '',
      createdAt: bitbucketServerDate(raw.createdDate),
      updatedAt: bitbucketServerDate(raw.updatedDate ?? raw.createdDate),
      deleted: false,
      inline,
      url: null
    })
    for (const reply of raw.comments ?? []) {
      visit(reply, raw.id, inline)
    }
  }
  for (const activity of activities) {
    if (activity.action === 'COMMENTED' && activity.comment) {
      visit(activity.comment, null, mapAnchor(activity.commentAnchor ?? activity.comment.anchor))
    }
  }
  return [...comments.values()].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id
  )
}

/** How the diff shows the anchored line; null when the diff does not show it. */
export function resolveBitbucketServerLineType(
  diff: RawBitbucketServerFileDiff,
  anchor: Pick<BitbucketCommentAnchor, 'line' | 'side'>
): ServerLineType | null {
  const unwanted = anchor.side === 'old' ? 'ADDED' : 'REMOVED'
  for (const segment of (diff.diffs ?? []).flatMap((file) =>
    (file.hunks ?? []).flatMap((hunk) => hunk.segments ?? [])
  )) {
    const type = segment.type
    if ((type !== 'ADDED' && type !== 'REMOVED' && type !== 'CONTEXT') || type === unwanted) {
      continue
    }
    const shown = (segment.lines ?? []).some(
      (line) => (anchor.side === 'old' ? line.source : line.destination) === anchor.line
    )
    if (shown) {
      return type
    }
  }
  return null
}

export function buildBitbucketServerCommentPayload(
  body: string,
  placement: { anchor?: BitbucketCommentAnchor & { lineType: ServerLineType }; parentId?: number }
): Record<string, unknown> {
  const { anchor, parentId } = placement
  return {
    text: body,
    ...(parentId === undefined ? {} : { parent: { id: parentId } }),
    ...(anchor && parentId === undefined
      ? {
          anchor: {
            path: anchor.path,
            line: anchor.line,
            lineType: anchor.lineType,
            fileType: anchor.side === 'old' ? 'FROM' : 'TO',
            diffType: 'EFFECTIVE'
          }
        }
      : {})
  }
}

function encodedFilePath(path: string): string {
  return path
    .replace(/^\.?\/+/, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/')
}

export async function listBitbucketServerPullRequestComments(
  target: BitbucketPullRequestTarget
): Promise<BitbucketReviewResult<BitbucketPullRequestCommentList>> {
  const activities: RawBitbucketServerActivity[] = []
  let start = 0
  for (let page = 0; page < MAX_ACTIVITY_PAGES; page += 1) {
    const reply = await getBitbucketServerJson<{
      values?: RawBitbucketServerActivity[]
      isLastPage?: boolean
      nextPageStart?: number | null
    }>(target, `/pull-requests/${target.id}/activities`, [
      ['limit', String(ACTIVITY_PAGE_SIZE)],
      ['start', String(start)]
    ])
    if (!reply.ok) {
      return reply
    }
    activities.push(...(reply.value.values ?? []))
    const next = reply.value.nextPageStart
    if (reply.value.isLastPage !== false || typeof next !== 'number' || next <= start) {
      return {
        ok: true,
        value: { comments: flattenBitbucketServerActivities(activities), truncated: false }
      }
    }
    start = next
  }
  return {
    ok: true,
    value: { comments: flattenBitbucketServerActivities(activities), truncated: true }
  }
}

export async function addBitbucketServerPullRequestComment(
  target: BitbucketPullRequestTarget,
  body: string,
  placement: { anchor?: BitbucketCommentAnchor; parentId?: number }
): Promise<BitbucketReviewResult<BitbucketPullRequestComment>> {
  let anchor: (BitbucketCommentAnchor & { lineType: ServerLineType }) | undefined
  if (placement.anchor && placement.parentId === undefined) {
    // Data Center wants the line's type in the diff; a wrong one orphans the comment.
    const diff = await getBitbucketServerJson<RawBitbucketServerFileDiff>(
      target,
      `/pull-requests/${target.id}/diff/${encodedFilePath(placement.anchor.path)}`,
      [['withComments', 'false']]
    )
    if (!diff.ok) {
      return diff
    }
    const lineType = resolveBitbucketServerLineType(diff.value, placement.anchor)
    if (!lineType) {
      return bitbucketReviewFailure(
        'bitbucket_line_not_in_diff',
        `Line ${placement.anchor.line} of ${placement.anchor.path} is not part of this pull request's diff. An inline comment needs a line the diff shows.`
      )
    }
    anchor = { ...placement.anchor, lineType }
  }
  const reply = await postBitbucketServerJson<RawBitbucketServerComment>(
    target,
    `/pull-requests/${target.id}/comments`,
    buildBitbucketServerCommentPayload(body, { anchor, parentId: placement.parentId })
  )
  if (!reply.ok) {
    return reply
  }
  const [comment] = flattenBitbucketServerActivities([
    { action: 'COMMENTED', comment: { ...reply.value, comments: [] } }
  ])
  return comment
    ? { ok: true, value: { ...comment, parentId: placement.parentId ?? null } }
    : bitbucketReviewFailure(
        'bitbucket_request_failed',
        'Bitbucket accepted the comment but returned no id. Check the pull request before retrying.'
      )
}
