// Which Bitbucket rules watch which repository, and the run event a new comment or review request
// starts. Everything the commenter or author wrote goes into the event's quoted fields.
import {
  MAX_AUTOMATION_EVENT_TEXT_LENGTH,
  type AutomationRunEvent
} from '../../shared/automation-event-triggers'
import {
  bitbucketTextMentions,
  DEFAULT_BITBUCKET_MENTION,
  isBitbucketTrigger,
  type AutomationBitbucketTrigger
} from '../../shared/automation-bitbucket-triggers'
import type { Automation } from '../../shared/automations/automation-definition'
import type { BitbucketPullRequestSummary } from '../../shared/bitbucket/bitbucket-pull-request-review'
import type { BitbucketRecentComment } from './cloud-pull-request-activity'

type MentionRule = Extract<AutomationBitbucketTrigger, { event: 'mentioned' }>
type ReviewRule = Extract<AutomationBitbucketTrigger, { event: 'review_requested' }>

export type BitbucketRuleTarget<
  Rule extends AutomationBitbucketTrigger = AutomationBitbucketTrigger
> = {
  automationId: string
  /** `workspace/repository` (Data Center: `project/repository`), lower case. */
  repo: string
  rule: Rule
}

/** The enabled bot automations' Bitbucket rules, once per repository each watches. */
export function bitbucketRuleTargets(
  automations: readonly Pick<Automation, 'id' | 'enabled' | 'bot' | 'on'>[]
): BitbucketRuleTarget[] {
  return automations.flatMap((automation) =>
    automation.enabled && automation.bot
      ? (automation.on ?? [])
          .filter((rule) => isBitbucketTrigger(rule))
          .flatMap((rule) =>
            rule.repos.map((repo) => ({ automationId: automation.id, repo, rule }))
          )
      : []
  )
}

export type BitbucketMentionTarget = BitbucketRuleTarget<MentionRule>
export type BitbucketReviewTarget = BitbucketRuleTarget<ReviewRule>

export function isMentionTarget(target: BitbucketRuleTarget): target is BitbucketMentionTarget {
  return target.rule.event === 'mentioned'
}

export function isReviewTarget(target: BitbucketRuleTarget): target is BitbucketReviewTarget {
  return target.rule.event === 'review_requested'
}

const fromAllows = (from: readonly string[] | undefined, id: string | null | undefined) =>
  !from?.length || (id != null && from.includes(id))

/**
 * A comment starts a rule only when someone else wrote it: one this host posted would otherwise
 * answer itself forever. `own` are the account ids this host comments as.
 */
export function mentionRuleMatches(
  rule: MentionRule,
  comment: BitbucketRecentComment,
  own: ReadonlySet<string>
): boolean {
  const author = comment.author?.id ?? null
  if (author !== null && own.has(author)) {
    return false
  }
  return (
    fromAllows(rule.from, author) &&
    bitbucketTextMentions(comment.body, rule.mention ?? DEFAULT_BITBUCKET_MENTION)
  )
}

export function reviewRuleMatches(rule: ReviewRule, pullRequest: BitbucketPullRequestSummary) {
  return fromAllows(rule.from, pullRequest.author?.id)
}

const quotedText = (title: string, body?: string) =>
  [`Pull request: ${title || '(no title)'}`, ...(body ? [body] : [])]
    .join('\n')
    .slice(0, MAX_AUTOMATION_EVENT_TEXT_LENGTH)

export function mentionRunEvent(
  target: BitbucketMentionTarget,
  comment: BitbucketRecentComment,
  now: number
): AutomationRunEvent {
  const { author } = comment
  return {
    triggerId: target.rule.id,
    source: 'bitbucket',
    event: 'mentioned',
    key: `bitbucket:${target.repo}:comment:${comment.id}`,
    // Later asks on the pull request fold into its unfinished run.
    subject: `bitbucket:${target.repo}#${comment.pullRequestId}`,
    occurredAt: Date.parse(comment.createdAt) || now,
    ...(author ? { actor: author.displayName } : {}),
    ...(author?.id ? { actorId: author.id } : {}),
    place: `${target.repo} #${comment.pullRequestId}`,
    url: comment.pullRequestUrl,
    text: quotedText(comment.pullRequestTitle, comment.body)
  }
}

export function reviewRunEvent(
  target: BitbucketReviewTarget,
  pullRequest: BitbucketPullRequestSummary,
  now: number
): AutomationRunEvent {
  const { author } = pullRequest
  return {
    triggerId: target.rule.id,
    source: 'bitbucket',
    event: 'review_requested',
    // Adding a reviewer moves `updatedAt`, so asking again later is a new event and a retry is not.
    key: `bitbucket:${target.repo}#${pullRequest.id}:review_requested:${pullRequest.updatedAt}`,
    subject: `bitbucket:${target.repo}#${pullRequest.id}`,
    occurredAt: now,
    ...(author ? { actor: author.displayName } : {}),
    ...(author?.id ? { actorId: author.id } : {}),
    place: `${target.repo} #${pullRequest.id}`,
    url: pullRequest.url,
    text: quotedText(pullRequest.title)
  }
}
