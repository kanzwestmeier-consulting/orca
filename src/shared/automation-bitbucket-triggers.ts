// Bitbucket automation rules: matched on the host that holds the Bitbucket connection, by asking
// Bitbucket about once a minute, so they are never sent to Orca Cloud and an older cloud never sees them.
import {
  parseBitbucketRepositoryInput,
  parseBitbucketServerRepositoryInput
} from './bitbucket/bitbucket-pull-request-target'

export const DEFAULT_BITBUCKET_MENTION = '@orca'

/** A client that reads Bitbucket automation rules without taking them for a missing connector. */
export const BITBUCKET_TRIGGERS_RUNTIME_CAPABILITY = 'bitbucket.triggers.v1' as const

const MAX_REPOS = 10
const MAX_PEOPLE = 10
const MAX_FILTER_LENGTH = 200

/**
 * A Bitbucket rule, checked on this host only. `repos` are `workspace/repository`; the host asks
 * only those, so a rule always names them.
 */
export type AutomationBitbucketTrigger =
  | {
      id: string
      source: 'bitbucket'
      event: 'mentioned'
      repos: string[]
      /** The phrase a pull request comment must contain; absent means DEFAULT_BITBUCKET_MENTION. */
      mention?: string
      /** Only these people's comments, by Bitbucket account id; absent means anyone. */
      from?: string[]
    }
  | {
      id: string
      source: 'bitbucket'
      event: 'review_requested'
      repos: string[]
      /** Only these authors' pull requests, by Bitbucket account id; absent means anyone's. */
      from?: string[]
    }

export function isBitbucketTrigger<Rule extends { source: string }>(
  trigger: Rule
): trigger is Extract<Rule, { source: 'bitbucket' }> {
  return trigger.source === 'bitbucket'
}

/**
 * `workspace/repository` in its one spelling, or null when it names no repository. On Data Center
 * that is `PROJECT/repository` or `~user/repository`; the host asks whichever Bitbucket it is
 * connected to. The workspace keeps its case: a Data Center project key is sent as it was written.
 */
export function bitbucketRepoKey(input: string): string | null {
  const repo = parseBitbucketRepositoryInput(input) ?? parseBitbucketServerRepositoryInput(input)
  return repo ? `${repo.workspace}/${repo.repoSlug.toLowerCase()}` : null
}

export function assertBitbucketTrigger(trigger: AutomationBitbucketTrigger): void {
  const name = `bitbucket.${trigger.event}`
  if (trigger.repos.length === 0 || trigger.repos.length > MAX_REPOS) {
    throw new Error(`${name} needs 1 to ${MAX_REPOS} repositories (repos=workspace/repository).`)
  }
  const unknown = trigger.repos.find((repo) => bitbucketRepoKey(repo) !== repo)
  if (unknown !== undefined) {
    throw new Error(`${name}: "${unknown}" is not a Bitbucket repository (workspace/repository).`)
  }
  // The wire shape is one object for both events, so a phrase can arrive on the wrong one.
  if (trigger.event === 'review_requested' && 'mention' in trigger) {
    throw new Error(`${name} takes no mention=.`)
  }
  const mention = trigger.event === 'mentioned' ? trigger.mention : undefined
  if (
    (trigger.from?.length ?? 0) > MAX_PEOPLE ||
    [mention, ...(trigger.from ?? [])].some((text) => (text?.length ?? 0) > MAX_FILTER_LENGTH)
  ) {
    throw new Error(`The ${name} trigger's filters are too long.`)
  }
  // A blank phrase would match every comment.
  if (mention !== undefined && !mention.trim()) {
    throw new Error(`${name} needs mention= to name a phrase.`)
  }
}

const escapeForPattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Whether a comment asks with `mention`, in any case. The phrase must stand alone ("@orca" is not in
 * "@orcabot" or "dev@orca.io"), and quoted lines don't count, so quoting a request never repeats it.
 */
export function bitbucketTextMentions(text: string, mention: string): boolean {
  const phrase = mention.trim()
  if (!phrase) {
    return false
  }
  const pattern = new RegExp(
    `(?<![\\w@.-])${phrase.split(/\s+/).map(escapeForPattern).join('\\s+')}(?![\\w-])`,
    'i'
  )
  return text.split('\n').some((line) => !/^\s*>/.test(line) && pattern.test(line))
}
