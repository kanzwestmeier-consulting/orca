import { describe, expect, it } from 'vitest'
import {
  buildBitbucketServerCommentPayload,
  flattenBitbucketServerActivities,
  resolveBitbucketServerLineType,
  type RawBitbucketServerFileDiff
} from './server-pull-request-comments'

const DIFF: RawBitbucketServerFileDiff = {
  diffs: [
    {
      hunks: [
        {
          segments: [
            { type: 'CONTEXT', lines: [{ source: 9, destination: 9 }] },
            { type: 'REMOVED', lines: [{ source: 10, destination: 10 }] },
            {
              type: 'ADDED',
              lines: [
                { source: 11, destination: 10 },
                { source: 11, destination: 11 }
              ]
            }
          ]
        }
      ]
    }
  ]
}

describe('resolveBitbucketServerLineType', () => {
  it('reads a new-side line from added or context lines, never from a removed one', () => {
    expect(resolveBitbucketServerLineType(DIFF, { line: 10, side: 'new' })).toBe('ADDED')
    expect(resolveBitbucketServerLineType(DIFF, { line: 9, side: 'new' })).toBe('CONTEXT')
  })

  it('reads an old-side line from removed or context lines, never from an added one', () => {
    expect(resolveBitbucketServerLineType(DIFF, { line: 10, side: 'old' })).toBe('REMOVED')
    expect(resolveBitbucketServerLineType(DIFF, { line: 11, side: 'old' })).toBeNull()
  })

  it('finds no type for a line the diff does not show', () => {
    expect(resolveBitbucketServerLineType(DIFF, { line: 200, side: 'new' })).toBeNull()
    expect(resolveBitbucketServerLineType({}, { line: 1, side: 'new' })).toBeNull()
  })
})

describe('buildBitbucketServerCommentPayload', () => {
  it('anchors to the changed file with TO and to the previous version with FROM', () => {
    expect(
      buildBitbucketServerCommentPayload('x', {
        anchor: { path: 'a.ts', line: 10, side: 'new', lineType: 'ADDED' }
      })
    ).toEqual({
      text: 'x',
      anchor: { path: 'a.ts', line: 10, lineType: 'ADDED', fileType: 'TO', diffType: 'EFFECTIVE' }
    })
    expect(
      buildBitbucketServerCommentPayload('x', {
        anchor: { path: 'a.ts', line: 10, side: 'old', lineType: 'REMOVED' }
      })
    ).toMatchObject({ anchor: { lineType: 'REMOVED', fileType: 'FROM' } })
    expect(buildBitbucketServerCommentPayload('x', { parentId: 5 })).toEqual({
      text: 'x',
      parent: { id: 5 }
    })
  })
})

describe('flattenBitbucketServerActivities', () => {
  it('lists nested replies oldest first with their parent and the thread anchor', () => {
    const comments = flattenBitbucketServerActivities([
      { action: 'APPROVED' },
      { action: 'COMMENTED', comment: { id: 9, text: 'Later', createdDate: 3000 } },
      {
        action: 'COMMENTED',
        commentAnchor: { path: 'a.ts', line: 10, lineType: 'REMOVED', fileType: 'FROM' },
        comment: {
          id: 1,
          text: 'Why?',
          createdDate: 1000,
          comments: [
            { id: 2, text: 'Because', createdDate: 2000, comments: [{ id: 3, createdDate: 2500 }] }
          ]
        }
      },
      { action: 'COMMENTED', comment: { id: 2, text: 'duplicate', createdDate: 2000 } }
    ])
    expect(
      comments.map(({ id, parentId, inline }) => [id, parentId, inline?.side ?? null])
    ).toEqual([
      [1, null, 'old'],
      [2, 1, 'old'],
      [3, 2, 'old'],
      [9, null, null]
    ])
    expect(comments[0].inline).toEqual({ path: 'a.ts', line: 10, side: 'old' })
    expect(comments[1].body).toBe('Because')
    expect(comments[0].createdAt).toBe('1970-01-01T00:00:01.000Z')
  })
})
