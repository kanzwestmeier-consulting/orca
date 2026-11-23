import type {
  BitbucketCommentAnchor,
  BitbucketPullRequestComment,
  BitbucketPullRequestCommentList,
  BitbucketPullRequestTarget,
  BitbucketReviewResult
} from '../../shared/bitbucket/bitbucket-pull-request-review'
import { mapBitbucketReviewUser, type RawBitbucketReviewUser } from './cloud-pull-request-read'
import { getBitbucketCloudJson, postBitbucketCloudJson } from './cloud-review-request'

const COMMENT_PAGE_SIZE = 100
const MAX_COMMENT_PAGES = 5

export type RawBitbucketComment = {
  id?: number
  content?: { raw?: string | null } | null
  user?: RawBitbucketReviewUser | null
  created_on?: string | null
  updated_on?: string | null
  deleted?: boolean | null
  parent?: { id?: number } | null
  inline?: { path?: string | null; from?: number | null; to?: number | null } | null
  links?: { html?: { href?: string } }
}

export function mapBitbucketCloudComment(
  raw: RawBitbucketComment
): BitbucketPullRequestComment | null {
  if (typeof raw.id !== 'number') {
    return null
  }
  const inline = raw.inline?.path
    ? {
        path: raw.inline.path,
        line: raw.inline.to ?? raw.inline.from ?? null,
        // Bitbucket sets `to` on the changed file and only `from` on a removed line.
        side: raw.inline.to == null && raw.inline.from != null ? ('old' as const) : ('new' as const)
      }
    : null
  return {
    id: raw.id,
    parentId: raw.parent?.id ?? null,
    author: mapBitbucketReviewUser(raw.user),
    body: raw.content?.raw ?? '',
    createdAt: raw.created_on ?? '',
    updatedAt: raw.updated_on ?? raw.created_on ?? '',
    deleted: raw.deleted === true,
    inline,
    url: raw.links?.html?.href ?? null
  }
}

export function buildBitbucketCloudCommentPayload(
  body: string,
  placement: { anchor?: BitbucketCommentAnchor; parentId?: number }
): Record<string, unknown> {
  const { anchor, parentId } = placement
  return {
    content: { raw: body },
    ...(parentId === undefined ? {} : { parent: { id: parentId } }),
    // A reply sits where its parent sits; Bitbucket rejects an anchor that disagrees.
    ...(anchor && parentId === undefined
      ? {
          inline: {
            path: anchor.path,
            ...(anchor.side === 'old' ? { from: anchor.line } : { to: anchor.line })
          }
        }
      : {})
  }
}

function commentsPath(target: BitbucketPullRequestTarget): string {
  return `/pullrequests/${target.id}/comments`
}

export async function listBitbucketCloudPullRequestComments(
  target: BitbucketPullRequestTarget
): Promise<BitbucketReviewResult<BitbucketPullRequestCommentList>> {
  const comments: BitbucketPullRequestComment[] = []
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const reply = await getBitbucketCloudJson<{ values?: RawBitbucketComment[]; next?: string }>(
      target,
      commentsPath(target),
      [
        ['sort', 'created_on'],
        ['pagelen', String(COMMENT_PAGE_SIZE)],
        ['page', String(page)]
      ]
    )
    if (!reply.ok) {
      return reply
    }
    const values = reply.value.values ?? []
    comments.push(...values.flatMap((raw) => mapBitbucketCloudComment(raw) ?? []))
    if (!reply.value.next || values.length === 0) {
      return { ok: true, value: { comments, truncated: false } }
    }
  }
  return { ok: true, value: { comments, truncated: true } }
}

export async function addBitbucketCloudPullRequestComment(
  target: BitbucketPullRequestTarget,
  body: string,
  placement: { anchor?: BitbucketCommentAnchor; parentId?: number }
): Promise<BitbucketReviewResult<BitbucketPullRequestComment>> {
  const reply = await postBitbucketCloudJson<RawBitbucketComment>(
    target,
    commentsPath(target),
    buildBitbucketCloudCommentPayload(body, placement)
  )
  if (!reply.ok) {
    return reply
  }
  const comment = mapBitbucketCloudComment(reply.value)
  return comment
    ? { ok: true, value: comment }
    : {
        ok: false,
        code: 'bitbucket_request_failed',
        error:
          'Bitbucket accepted the comment but returned no id. Check the pull request before retrying.'
      }
}
