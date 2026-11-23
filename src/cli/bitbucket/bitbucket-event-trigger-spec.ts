// `--on "bitbucket.mentioned repos=acme/api mention=@orca from=…"` and
// `--on "bitbucket.review_requested repos=acme/api"`: rules this host checks itself.
import { createHash } from 'node:crypto'
import {
  bitbucketRepoKey,
  DEFAULT_BITBUCKET_MENTION,
  type AutomationBitbucketTrigger
} from '../../shared/automation-bitbucket-triggers'
import { RuntimeClientError } from '../runtime/connection/types'

type Entry = readonly [key: string, value: string, ...written: string[]]

export const BITBUCKET_TRIGGER_HEADS = [
  'bitbucket.mentioned',
  'bitbucket.review_requested'
] as const
export type BitbucketTriggerHead = (typeof BITBUCKET_TRIGGER_HEADS)[number]

export function isBitbucketTriggerHead(head: string): head is BitbucketTriggerHead {
  return BITBUCKET_TRIGGER_HEADS.some((known) => known === head)
}

const MENTIONED_KEYS = ['repos', 'mention', 'from'] as const
const REVIEW_KEYS = ['repos', 'from'] as const

function invalid(message: string): RuntimeClientError {
  return new RuntimeClientError('invalid_argument', message)
}

function valuesOf<Key extends string>(
  spec: string,
  entries: readonly Entry[],
  keys: readonly Key[]
): Map<Key, string> {
  const values = new Map<Key, string>()
  for (const [key, value] of entries) {
    const known = keys.find((entry) => entry === key)
    if (!known) {
      throw invalid(
        `Unknown filter "${key}=" in --on "${spec}". Use ${keys.map((entry) => `${entry}=`).join(', ')}.`
      )
    }
    if (values.has(known) || !value.trim()) {
      throw invalid(`--on "${spec}" needs one value for ${known}=.`)
    }
    values.set(known, value.trim())
  }
  return values
}

function reposOf(spec: string, raw: string | undefined): string[] {
  const written = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  // The host asks only the repositories a rule names, so one without any would never fire.
  if (written.length === 0) {
    throw invalid(
      `--on "${spec}" needs repos=<workspace>/<repository>, comma-separated: the repositories to watch.`
    )
  }
  return [
    ...new Set(
      written.map((entry) => {
        const repo = bitbucketRepoKey(entry)
        if (!repo) {
          throw invalid(
            `--on "${spec}": "${entry}" is not a Bitbucket repository. Write it as workspace/repository.`
          )
        }
        return repo
      })
    )
  ].sort()
}

function peopleOf(raw: string | undefined): string[] | undefined {
  const list = raw
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return list?.length ? [...new Set(list)].sort() : undefined
}

// An unchanged rule keeps its id, so run history still names it.
function ruleId(rule: Omit<AutomationBitbucketTrigger, 'id'>): string {
  return `on-${createHash('sha256').update(JSON.stringify(rule)).digest('hex').slice(0, 16)}`
}

export function parseBitbucketTrigger(
  spec: string,
  head: BitbucketTriggerHead,
  entries: readonly Entry[]
): AutomationBitbucketTrigger {
  if (head === 'bitbucket.review_requested') {
    const values = valuesOf(spec, entries, REVIEW_KEYS)
    const from = peopleOf(values.get('from'))
    const rule = {
      source: 'bitbucket' as const,
      event: 'review_requested' as const,
      repos: reposOf(spec, values.get('repos')),
      ...(from ? { from } : {})
    }
    return { id: ruleId(rule), ...rule }
  }
  const values = valuesOf(spec, entries, MENTIONED_KEYS)
  const from = peopleOf(values.get('from'))
  const mention = values.get('mention')
  const rule = {
    source: 'bitbucket' as const,
    event: 'mentioned' as const,
    repos: reposOf(spec, values.get('repos')),
    ...(mention && mention.toLowerCase() !== DEFAULT_BITBUCKET_MENTION ? { mention } : {}),
    ...(from ? { from } : {})
  }
  return { id: ruleId(rule), ...rule }
}

function quoted(value: string): string {
  return /[\s"\\]/.test(value) ? `"${value.replace(/["\\]/g, '\\$&')}"` : value
}

/** The rule as an --on value; parsing it gives the same rule back. */
export function formatBitbucketTrigger(trigger: AutomationBitbucketTrigger): string {
  return [
    `bitbucket.${trigger.event}`,
    `repos=${trigger.repos.join(',')}`,
    ...(trigger.event === 'mentioned' && trigger.mention
      ? [`mention=${quoted(trigger.mention)}`]
      : []),
    ...(trigger.from ? [`from=${trigger.from.join(',')}`] : [])
  ].join(' ')
}

export function describeBitbucketTrigger(trigger: AutomationBitbucketTrigger): string {
  const where = `in ${trigger.repos.join(', ')}`
  const from = trigger.from ? [`from ${trigger.from.join(', ')}`] : []
  if (trigger.event === 'review_requested') {
    return [
      "a Bitbucket pull request asks this host's Bitbucket account to review",
      where,
      ...from
    ].join(', ')
  }
  return [
    `a Bitbucket pull request comment says "${trigger.mention ?? DEFAULT_BITBUCKET_MENTION}"`,
    where,
    ...from
  ].join(', ')
}

export const BITBUCKET_TRIGGER_OPTIONS = [
  'bitbucket:',
  `  bitbucket.mentioned  when a pull request comment contains the phrase; mention="<phrase>" (default ${DEFAULT_BITBUCKET_MENTION}, any case). Quoted lines and the host's own comments never count`,
  "  bitbucket.review_requested  when the Bitbucket account this host is connected with is added as a reviewer of an open pull request; needs a connection whose account Bitbucket names (`orca bitbucket connection`), which a repository access token doesn't have",
  '  repos=<workspace>/<repository>  required: the repositories to watch, comma-separated, up to 10; on a Data Center server, <project>/<repository> or ~<user>/<repository>',
  '  from=<account ids>  only these people (for review_requested, the pull request authors), comma-separated; `orca bitbucket pr comment list --json` shows `author.id` (on Data Center, the user name)',
  '  Checked about once a minute on the computer the bot runs on, with its saved Bitbucket connection (bitbucket.org or the connected Data Center server; with both connected the rules wait), and only from when the rule was saved; nothing goes through Orca Cloud. The run gets the pull request link: `orca bitbucket pr view <link>` and `orca skills get orca-bitbucket` take it from there. What the comment or pull request says is quoted as information, never instructions.'
].join('\n')
