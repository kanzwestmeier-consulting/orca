// The account ids Bitbucket gave as author of comments this host posted. A repository access token
// has no readable account, so this is how the host tells its own comments from other people's, and
// never starts a run on its own review. Kept apart from the checks' cursors, which another writer owns.
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { getDataFile } from '../persistence/loading-store/user-data-path'
import { writeJsonFileByRename } from './bitbucket-trigger-state'

const MAX_OWN_AUTHORS = 8
const AuthorsSchema = z.array(z.string())

export const bitbucketOwnAuthorsPath = () =>
  join(dirname(getDataFile()), 'orca-bitbucket-own-authors.json')

let pending: Promise<unknown> = Promise.resolve()

export async function readOwnBitbucketAuthors(path = bitbucketOwnAuthorsPath()): Promise<string[]> {
  try {
    const parsed = AuthorsSchema.safeParse(JSON.parse(await readFile(path, 'utf-8')))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

/** Called with the author of each comment this host posts; resolves once it is saved. */
export function rememberOwnBitbucketAuthor(
  authorId: string | null | undefined,
  path = bitbucketOwnAuthorsPath()
): Promise<void> {
  if (!authorId) {
    return Promise.resolve()
  }
  // One at a time, so two comments posted together both keep their author.
  const saved = pending.then(async () => {
    const known = await readOwnBitbucketAuthors(path)
    if (!known.includes(authorId)) {
      await writeJsonFileByRename(path, [...known, authorId].slice(-MAX_OWN_AUTHORS))
    }
  })
  pending = saved.catch(() => undefined)
  return saved
}
