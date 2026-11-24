// Where each watched Bitbucket repository's checks left off: the newest comment seen and the pull
// requests already asking for a review. No secrets. It sits beside this runtime's own data: another
// Orca on this machine has its own rules.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { getDataFile } from '../persistence/loading-store/user-data-path'

const StateSchema = z.object({
  /** By `workspace/repository`. */
  repos: z
    .record(
      z.string(),
      z.object({
        /** Comments up to this id never start a run. */
        commentId: z.number().optional(),
        /** Data Center: when the repository was first looked at; older comments never start a run. */
        since: z.number().optional(),
        /** Data Center has no repository feed: each open pull request's mark, newest comment seen and last read. */
        pulls: z
          .record(
            z.string(),
            z.object({ mark: z.string(), commentId: z.number(), readAt: z.number().optional() })
          )
          .optional(),
        /** Open pull requests whose review request already started its runs. */
        requested: z.array(z.number()).optional()
      })
    )
    .default({})
})

export type BitbucketTriggerState = z.infer<typeof StateSchema>
export type BitbucketRepositoryCheckState = BitbucketTriggerState['repos'][string]

export const bitbucketTriggerStatePath = () =>
  join(dirname(getDataFile()), 'orca-bitbucket-triggers.json')

export async function readBitbucketTriggerState(
  path = bitbucketTriggerStatePath()
): Promise<BitbucketTriggerState> {
  try {
    const parsed = StateSchema.safeParse(JSON.parse(await readFile(path, 'utf-8')))
    if (parsed.success) {
      return parsed.data
    }
  } catch {
    // Nothing saved yet, or unreadable: start from now.
  }
  return { repos: {} }
}

export async function writeBitbucketTriggerState(
  state: BitbucketTriggerState,
  path = bitbucketTriggerStatePath()
): Promise<void> {
  await writeJsonFileByRename(path, state)
}

/** A reader never sees half a file: the text lands under another name first. */
export async function writeJsonFileByRename(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const pending = `${path}.${process.pid}.tmp`
  await writeFile(pending, `${JSON.stringify(value)}\n`, 'utf-8')
  await rename(pending, path)
}
