import type { BitbucketCommentAnchor } from '../../shared/bitbucket/bitbucket-pull-request-review'

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * Whether a git-format diff of one file shows `line`: an added or unchanged line of the new file,
 * or with `side: 'old'` a removed or unchanged line of the previous one.
 */
export function diffShowsLine(
  diff: string,
  { line, side }: Pick<BitbucketCommentAnchor, 'line' | 'side'>
): boolean {
  let oldLine = 0
  let newLine = 0
  let inHunk = false
  for (const text of diff.replace(/\n$/, '').split('\n')) {
    const header = HUNK_HEADER.exec(text)
    if (header) {
      oldLine = Number(header[1])
      newLine = Number(header[2])
      inHunk = true
      continue
    }
    if (!inHunk || text.startsWith('\\')) {
      continue
    }
    if (text.startsWith('+')) {
      if (side === 'new' && newLine === line) {
        return true
      }
      newLine += 1
    } else if (text.startsWith('-')) {
      if (side === 'old' && oldLine === line) {
        return true
      }
      oldLine += 1
    } else if (text === '' || text.startsWith(' ')) {
      // Some servers strip the single space of an empty unchanged line.
      if ((side === 'old' ? oldLine : newLine) === line) {
        return true
      }
      oldLine += 1
      newLine += 1
    } else {
      inHunk = false
    }
  }
  return false
}
