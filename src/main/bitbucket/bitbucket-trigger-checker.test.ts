import { describe, expect, it } from 'vitest'
import type { AutomationRunEvent } from '../../shared/automation-event-triggers'
import type { BitbucketPullRequestSummary } from '../../shared/bitbucket/bitbucket-pull-request-review'
import {
  BitbucketTriggerChecker,
  type BitbucketTriggerCheckerDeps
} from './bitbucket-trigger-checker'
import { lookAtBitbucketCloudComments } from './bitbucket-comment-look'
import type { BitbucketTriggerState } from './bitbucket-trigger-state'
import type { BitbucketRecentComment } from './cloud-pull-request-activity'

const NOW = Date.parse('2026-11-23T12:00:00Z')
const REPO = 'acme/api'

const comment = (id: number, body: string, authorId = 'dana'): BitbucketRecentComment => ({
  id,
  pullRequestId: 7,
  pullRequestTitle: 'Add retries',
  pullRequestUrl: `https://bitbucket.org/${REPO}/pull-requests/7`,
  author: { id: authorId, displayName: authorId },
  body,
  createdAt: new Date(NOW - 1000).toISOString()
})

const pullRequest = (id: number): BitbucketPullRequestSummary => ({
  id,
  title: 'Add retries',
  state: 'open',
  author: { id: 'dana', displayName: 'Dana' },
  sourceBranch: 'retries',
  destinationBranch: 'main',
  url: `https://bitbucket.org/${REPO}/pull-requests/${id}`,
  updatedAt: '2026-11-23T11:00:00+00:00'
})

function setUp(
  event: 'mentioned' | 'review_requested',
  options: { accountId?: string | null } = {}
) {
  const feed: BitbucketRecentComment[] = []
  const asking: BitbucketPullRequestSummary[] = []
  const ownAuthors: string[] = []
  const state: BitbucketTriggerState = { repos: {} }
  const started: AutomationRunEvent[] = []
  const host = { feed, asking, ownAuthors, failStarts: false, state, started }
  const deps: BitbucketTriggerCheckerDeps = {
    automations: () => [
      {
        id: 'auto-1',
        enabled: true,
        bot: { botId: 'bot-1', runsIn: 'new', resultsTo: 'chat' },
        on: [{ id: 'on-1', source: 'bitbucket', event, repos: [REPO] }]
      }
    ],
    accountId: async () => (options.accountId === undefined ? 'orca-account' : options.accountId),
    ownAuthors: async () => host.ownAuthors,
    newComments: (repo, saved) =>
      lookAtBitbucketCloudComments(
        async (afterId) => ({
          ok: true,
          value: {
            comments: host.feed.filter((entry) => afterId !== null && entry.id > afterId),
            newestId: host.feed.at(-1)?.id ?? null,
            skipped: false
          }
        }),
        saved,
        repo
      ),
    reviewRequests: async () => ({ ok: true, value: host.asking }),
    runForEvent: async (_automationId, started) => {
      if (host.failStarts) {
        throw new Error('no chat')
      }
      host.started.push(started)
    },
    readState: async () => structuredClone(host.state),
    writeState: async (state) => {
      host.state = state
    },
    now: () => NOW
  }
  return { host, checker: new BitbucketTriggerChecker(deps) }
}

describe('BitbucketTriggerChecker', () => {
  it('starts one run for a new ask and none for what was there before the rule', async () => {
    const { host, checker } = setUp('mentioned')
    host.feed = [comment(10, '@orca review')]
    await checker.tick()
    host.feed.push(comment(11, 'looks fine'), comment(12, 'hey @orca review this'))
    await checker.tick()
    await checker.tick()

    expect(host.started.map((event) => event.key)).toEqual(['bitbucket:acme/api:comment:12'])
    expect(host.started[0]).toMatchObject({
      source: 'bitbucket',
      event: 'mentioned',
      subject: 'bitbucket:acme/api#7',
      actorId: 'dana',
      url: 'https://bitbucket.org/acme/api/pull-requests/7'
    })
    expect(host.state.repos[REPO]).toEqual({ commentId: 12 })
  })

  it('never starts on a comment this host posted, by its account or a remembered author', async () => {
    const { host, checker } = setUp('mentioned')
    await checker.tick()
    host.ownAuthors = ['token-bot']
    host.feed = [
      comment(1, '@orca review', 'orca-account'),
      comment(2, '@orca review', 'token-bot')
    ]
    await checker.tick()

    expect(host.started).toEqual([])
    expect(host.state.repos[REPO]).toEqual({ commentId: 2 })
  })

  it('keeps its place when a run cannot start, and tries the same comment again', async () => {
    const { host, checker } = setUp('mentioned')
    await checker.tick()
    host.feed = [comment(5, '@orca review')]
    host.failStarts = true
    await checker.tick()
    expect(host.state.repos[REPO]).toEqual({ commentId: 0 })

    host.failStarts = false
    await checker.tick()
    expect(host.started.map((event) => event.key)).toEqual(['bitbucket:acme/api:comment:5'])
  })

  it('starts once per review request, and again after the request went away and came back', async () => {
    const { host, checker } = setUp('review_requested')
    host.asking = [pullRequest(1)]
    await checker.tick()
    host.asking = [pullRequest(1), pullRequest(2)]
    await checker.tick()
    await checker.tick()
    expect(host.started.map((event) => event.subject)).toEqual(['bitbucket:acme/api#2'])

    host.asking = [pullRequest(1)]
    await checker.tick()
    host.asking = [pullRequest(1), pullRequest(2)]
    await checker.tick()
    expect(host.started).toHaveLength(2)
  })

  it('starts nothing on review requests while Bitbucket names no account', async () => {
    const { host, checker } = setUp('review_requested', { accountId: null })
    await checker.tick()
    host.asking = [pullRequest(3)]
    await checker.tick()
    expect(host.started).toEqual([])
  })
})
