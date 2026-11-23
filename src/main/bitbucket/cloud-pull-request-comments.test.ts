import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildBitbucketCloudCommentPayload,
  listBitbucketCloudPullRequestComments,
  mapBitbucketCloudComment
} from './cloud-pull-request-comments'

describe('buildBitbucketCloudCommentPayload', () => {
  it('anchors a new-side comment with `to` and an old-side comment with `from`', () => {
    expect(
      buildBitbucketCloudCommentPayload('x', { anchor: { path: 'a.ts', line: 12, side: 'new' } })
    ).toEqual({ content: { raw: 'x' }, inline: { path: 'a.ts', to: 12 } })
    expect(
      buildBitbucketCloudCommentPayload('x', { anchor: { path: 'a.ts', line: 9, side: 'old' } })
    ).toEqual({ content: { raw: 'x' }, inline: { path: 'a.ts', from: 9 } })
  })

  it('sends a reply with its parent and no anchor of its own', () => {
    expect(
      buildBitbucketCloudCommentPayload('x', {
        parentId: 5,
        anchor: { path: 'a.ts', line: 12, side: 'new' }
      })
    ).toEqual({ content: { raw: 'x' }, parent: { id: 5 } })
    expect(buildBitbucketCloudCommentPayload('x', {})).toEqual({ content: { raw: 'x' } })
  })
})

describe('mapBitbucketCloudComment', () => {
  it('reads the side and line Bitbucket anchored a comment to', () => {
    const inlineOf = (inline: { path: string; from?: number | null; to?: number | null }) =>
      mapBitbucketCloudComment({ id: 1, inline })?.inline
    expect(inlineOf({ path: 'a.ts', from: null, to: 12 })).toEqual({
      path: 'a.ts',
      line: 12,
      side: 'new'
    })
    expect(inlineOf({ path: 'a.ts', from: 9, to: null })).toEqual({
      path: 'a.ts',
      line: 9,
      side: 'old'
    })
    expect(inlineOf({ path: 'a.ts', from: 9, to: 12 })).toEqual({
      path: 'a.ts',
      line: 12,
      side: 'new'
    })
    expect(inlineOf({ path: 'a.ts' })).toEqual({ path: 'a.ts', line: null, side: 'new' })
    expect(mapBitbucketCloudComment({ id: 1 })?.inline).toBeNull()
  })
})

describe('listBitbucketCloudPullRequestComments', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('never sends the credential to the next-page URL a reply names', async () => {
    vi.stubEnv('ORCA_BITBUCKET_ACCESS_TOKEN', 'secret-token')
    vi.stubEnv('ORCA_BITBUCKET_API_BASE_URL', 'https://api.bitbucket.org/2.0')
    const requested: string[] = []
    vi.stubGlobal('fetch', async (url: URL) => {
      requested.push(url.toString())
      const page = Number(url.searchParams.get('page'))
      return Response.json({
        values: [{ id: page }],
        ...(page < 2 ? { next: 'https://evil.example/steal?page=2' } : {})
      })
    })

    const reply = await listBitbucketCloudPullRequestComments({
      workspace: 'acme',
      repoSlug: 'api',
      id: 42
    })

    expect(reply.ok && reply.value.comments.map((comment) => comment.id)).toEqual([1, 2])
    expect(requested).toHaveLength(2)
    for (const url of requested) {
      expect(
        url.startsWith(
          'https://api.bitbucket.org/2.0/repositories/acme/api/pullrequests/42/comments?'
        )
      ).toBe(true)
    }
  })
})
