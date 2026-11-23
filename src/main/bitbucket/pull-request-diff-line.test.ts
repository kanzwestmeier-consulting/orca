import { describe, expect, it } from 'vitest'
import { diffShowsLine } from './pull-request-diff-line'

const DIFF = [
  'diff --git a/README.md b/README.md',
  'index 16eff96..68ee296 100644',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -6,7 +6,9 @@ When you are done',
  ' ',
  ' ---',
  '',
  '-## Edit a file',
  '+## Edit a file for the review',
  '+',
  '+A new paragraph.',
  ' ',
  ' Start by editing this file.',
  ' ',
  '@@ -40,2 +42,2 @@',
  ' kept',
  '-dropped',
  '\\ No newline at end of file',
  '+changed',
  '\\ No newline at end of file',
  ''
].join('\n')

describe('diffShowsLine', () => {
  it('finds added and unchanged lines by their number in the new file', () => {
    expect(
      [6, 9, 11, 14, 42, 43].map((line) => diffShowsLine(DIFF, { line, side: 'new' }))
    ).toEqual([true, true, true, true, true, true])
  })

  it('finds removed and unchanged lines by their number in the old file', () => {
    expect([8, 9, 12, 41].map((line) => diffShowsLine(DIFF, { line, side: 'old' }))).toEqual([
      true,
      true,
      true,
      true
    ])
  })

  it('rejects lines outside the hunks, on either side', () => {
    expect([5, 15, 41, 44, 500].map((line) => diffShowsLine(DIFF, { line, side: 'new' }))).toEqual([
      false,
      false,
      false,
      false,
      false
    ])
    expect([5, 13, 43].map((line) => diffShowsLine(DIFF, { line, side: 'old' }))).toEqual([
      false,
      false,
      false
    ])
  })
})
