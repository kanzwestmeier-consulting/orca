// The checks behind bots' Bitbucket rules. It rides the host's automation tick (about a minute) on
// the computer that holds the Bitbucket connection, asks only the repositories an enabled rule
// names, and hands each match to the same event path the cloud's deliveries take, which drops repeats.
import type { AutomationRunEvent } from '../../shared/automation-event-triggers'
import type { Automation } from '../../shared/automations/automation-definition'
import type {
  BitbucketPullRequestSummary,
  BitbucketReviewFailure,
  BitbucketReviewResult
} from '../../shared/bitbucket/bitbucket-pull-request-review'
import type { BitbucketRecentComments } from './cloud-pull-request-activity'
import {
  bitbucketRuleTargets,
  isMentionTarget,
  isReviewTarget,
  mentionRuleMatches,
  mentionRunEvent,
  reviewRuleMatches,
  reviewRunEvent,
  type BitbucketMentionTarget,
  type BitbucketReviewTarget,
  type BitbucketRuleTarget
} from './bitbucket-trigger-match'
import type { BitbucketTriggerState } from './bitbucket-trigger-state'

// Bitbucket Cloud allows about 1000 repository requests an hour; the checks stay well under it, so
// with many repositories each one is simply asked less often.
const MAX_REQUESTS_PER_TICK = 8
// After the host was off for days, an old ask no longer starts a review.
const MAX_COMMENT_AGE_MS = 24 * 60 * 60_000
const ACCOUNT_MAX_AGE_MS = 10 * 60_000
const RATE_LIMIT_BACKOFF_MS = 60_000
const ERROR_BACKOFF_MS = 5 * 60_000
const MAX_BACKOFF_MS = 30 * 60_000

type Check = { repo: string; kind: 'comments' | 'reviews' }
const checkKey = (check: Check) => `${check.repo} ${check.kind}`

export type BitbucketTriggerCheckerDeps = {
  automations(): readonly Pick<Automation, 'id' | 'enabled' | 'bot' | 'on'>[]
  /** The account id of the saved connection; null when Bitbucket names none (an access token). */
  accountId(): Promise<string | null>
  /** Account ids this host has commented as. */
  ownAuthors(): Promise<readonly string[]>
  recentComments(
    repo: string,
    afterId: number | null
  ): Promise<BitbucketReviewResult<BitbucketRecentComments>>
  reviewRequests(
    repo: string,
    accountId: string
  ): Promise<BitbucketReviewResult<BitbucketPullRequestSummary[]>>
  runForEvent(automationId: string, event: AutomationRunEvent): Promise<unknown>
  readState(): Promise<BitbucketTriggerState>
  writeState(state: BitbucketTriggerState): Promise<void>
  now(): number
}

export class BitbucketTriggerChecker {
  private checking = false
  private stopped = false
  private readonly backoff = new Map<string, { until: number; failures: number }>()
  private readonly lastChecked = new Map<string, number>()
  private account: { id: string | null; readAt: number } | null = null
  private warnedNoAccount = false
  /** No rule watches anything and the saved cursors are gone, so a tick has nothing to do. */
  private idle = false

  constructor(private readonly deps: BitbucketTriggerCheckerDeps) {}

  /** One check, unless the last is still running. */
  tick(): Promise<void> {
    if (this.checking || this.stopped) {
      return Promise.resolve()
    }
    this.checking = true
    return this.check()
      .catch((error: unknown) => console.warn('[bitbucket] trigger check failed', error))
      .finally(() => {
        this.checking = false
      })
  }

  stop(): void {
    this.stopped = true
  }

  private async check(): Promise<void> {
    const targets = bitbucketRuleTargets(this.deps.automations())
    if (targets.length === 0 && this.idle) {
      return
    }
    // The first check without rules still runs: it drops cursors a removed rule left behind.
    this.idle = targets.length === 0
    const state = await this.deps.readState()
    const before = JSON.stringify(state)
    const now = this.deps.now()
    const checks = this.dueChecks(targets, state, now)
    if (checks.length > 0) {
      const accountId = await this.accountId(now)
      const own = new Set([...(await this.deps.ownAuthors()), ...(accountId ? [accountId] : [])])
      for (const check of checks) {
        if (this.stopped) {
          break
        }
        const mine = targets.filter((target) => target.repo === check.repo)
        this.lastChecked.set(checkKey(check), now)
        const failure =
          check.kind === 'comments'
            ? await this.checkComments(check.repo, mine.filter(isMentionTarget), own, state, now)
            : await this.checkReviews(
                check.repo,
                mine.filter(isReviewTarget),
                accountId,
                state,
                now
              )
        this.noteOutcome(check, failure, now)
      }
    }
    if (JSON.stringify(state) !== before) {
      await this.deps.writeState(state)
    }
  }

  // Each repository's comments and review requests are one request each. The longest-waiting come
  // first, and a repository no rule watches any more is forgotten, so a later rule starts from then.
  private dueChecks(targets: BitbucketRuleTarget[], state: BitbucketTriggerState, now: number) {
    const wanted = new Map<string, Check>()
    for (const target of targets) {
      const check: Check = {
        repo: target.repo,
        kind: isMentionTarget(target) ? 'comments' : 'reviews'
      }
      wanted.set(checkKey(check), check)
    }
    for (const key of this.lastChecked.keys()) {
      if (!wanted.has(key)) {
        this.lastChecked.delete(key)
        this.backoff.delete(key)
      }
    }
    for (const [repo, saved] of Object.entries(state.repos)) {
      if (!wanted.has(checkKey({ repo, kind: 'comments' }))) {
        delete saved.commentId
      }
      if (!wanted.has(checkKey({ repo, kind: 'reviews' }))) {
        delete saved.requested
      }
      if (saved.commentId === undefined && saved.requested === undefined) {
        delete state.repos[repo]
      }
    }
    return [...wanted.values()]
      .filter((check) => now >= (this.backoff.get(checkKey(check))?.until ?? 0))
      .sort(
        (a, b) =>
          (this.lastChecked.get(checkKey(a)) ?? 0) - (this.lastChecked.get(checkKey(b)) ?? 0)
      )
      .slice(0, MAX_REQUESTS_PER_TICK)
  }

  private async accountId(now: number): Promise<string | null> {
    if (!this.account || now - this.account.readAt >= ACCOUNT_MAX_AGE_MS) {
      this.account = { id: await this.deps.accountId().catch(() => null), readAt: now }
    }
    return this.account.id
  }

  // A rate limit or an outage pauses that repository's check, longer each time, never the others.
  private noteOutcome(check: Check, failure: BitbucketReviewFailure | null, now: number): void {
    const key = checkKey(check)
    if (!failure) {
      this.backoff.delete(key)
      return
    }
    const failures = (this.backoff.get(key)?.failures ?? 0) + 1
    const base =
      failure.code === 'bitbucket_rate_limited' ? RATE_LIMIT_BACKOFF_MS : ERROR_BACKOFF_MS
    this.backoff.set(key, {
      failures,
      until: now + Math.min(base * 2 ** (failures - 1), MAX_BACKOFF_MS)
    })
    if (failures === 1) {
      console.warn(
        `[bitbucket] ${check.kind} check for ${check.repo} failed; backing off: ${failure.code}`
      )
    }
  }

  private async checkComments(
    repo: string,
    targets: BitbucketMentionTarget[],
    own: ReadonlySet<string>,
    state: BitbucketTriggerState,
    now: number
  ): Promise<BitbucketReviewFailure | null> {
    const saved = (state.repos[repo] ??= {})
    const reply = await this.deps.recentComments(repo, saved.commentId ?? null)
    if (!reply.ok) {
      return reply
    }
    // The first look only marks where the repository stands: older comments never start a run.
    if (saved.commentId === undefined) {
      saved.commentId = reply.value.newestId ?? 0
      return null
    }
    if (reply.value.skipped) {
      console.warn(`[bitbucket] skipped older new comments in ${repo}`)
    }
    for (const comment of reply.value.comments) {
      const fresh = now - (Date.parse(comment.createdAt) || now) <= MAX_COMMENT_AGE_MS
      for (const target of fresh ? targets : []) {
        if (
          mentionRuleMatches(target.rule, comment, own) &&
          !(await this.fire(target.automationId, mentionRunEvent(target, comment, now)))
        ) {
          // Stays before this comment, so the next check tries it again; the run path drops repeats.
          return null
        }
      }
      saved.commentId = comment.id
    }
    return null
  }

  private async checkReviews(
    repo: string,
    targets: BitbucketReviewTarget[],
    accountId: string | null,
    state: BitbucketTriggerState,
    now: number
  ): Promise<BitbucketReviewFailure | null> {
    if (!accountId) {
      // Once per stretch, not every tick.
      if (!this.warnedNoAccount) {
        console.warn(
          "[bitbucket] review_requested rules are paused: Bitbucket doesn't name the connected account"
        )
      }
      this.warnedNoAccount = true
      return null
    }
    this.warnedNoAccount = false
    const reply = await this.deps.reviewRequests(repo, accountId)
    if (!reply.ok) {
      return reply
    }
    const saved = (state.repos[repo] ??= {})
    const asking = reply.value
    // The first look only marks what already waits: an older request never starts a run.
    if (saved.requested === undefined) {
      saved.requested = asking.map((pullRequest) => pullRequest.id)
      return null
    }
    const known = new Set(saved.requested)
    const started: number[] = []
    for (const pullRequest of asking) {
      if (known.has(pullRequest.id)) {
        started.push(pullRequest.id)
        continue
      }
      let allStarted = true
      for (const target of targets) {
        if (reviewRuleMatches(target.rule, pullRequest)) {
          allStarted =
            (await this.fire(target.automationId, reviewRunEvent(target, pullRequest, now))) &&
            allStarted
        }
      }
      // A failed start leaves the request unmarked, so the next check tries it again.
      if (allStarted) {
        started.push(pullRequest.id)
      }
    }
    // A request that went away is forgotten, so asking again later starts a new run.
    saved.requested = started
    return null
  }

  /** False when the run path failed, so the caller keeps its place and the next check retries. */
  private async fire(automationId: string, event: AutomationRunEvent): Promise<boolean> {
    try {
      await this.deps.runForEvent(automationId, event)
      return true
    } catch (error) {
      console.warn('[bitbucket] could not start an automation run', error)
      return false
    }
  }
}
