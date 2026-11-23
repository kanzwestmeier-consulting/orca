import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BitbucketRepositoryCheckState } from './bitbucket-trigger-state'
import {
  listBitbucketServerReviewRequests,
  lookAtBitbucketServerComments
} from './server-pull-request-activity'

const OLD_ENV = process.env
const REPO = { workspace: 'prj', repoSlug: 'api', dialect: 'server' as const }
const T0 = Date.parse('2026-11-24T08:00:00Z')

type FakePullRequest = {
  id: number
  title: string
  updatedDate: number
  reviewers: { user: { name: string } }[]
  properties: { commentCount: number }
  activities: unknown[]
}

describe('Bitbucket Data Center trigger checks', () => {
  let server: Server
  let baseUrl = ''
  let pullRequests: FakePullRequest[] = []
  let activityReads: number[] = []

  beforeEach(async () => {
    pullRequests = []
    activityReads = []
    server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      const activities = /\/pull-requests\/(\d+)\/activities$/.exec(path)
      const body = activities
        ? {
            values: pullRequests.find((entry) => entry.id === Number(activities[1]))?.activities,
            isLastPage: true
          }
        : {
            values: pullRequests.map(({ activities: _activities, ...listed }) => listed),
            isLastPage: true
          }
      if (activities) {
        activityReads.push(Number(activities[1]))
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(body))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('expected a TCP address')
    }
    baseUrl = `http://127.0.0.1:${address.port}`
    process.env = {
      ...OLD_ENV,
      ORCA_BITBUCKET_SERVER_BASE_URL: baseUrl,
      ORCA_BITBUCKET_SERVER_TOKEN: 'server-token'
    }
  })

  afterEach(async () => {
    process.env = OLD_ENV
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  const commented = (id: number, text: string, createdDate: number, replies: unknown[] = []) => ({
    action: 'COMMENTED',
    comment: { id, text, author: { name: 'dana' }, createdDate, comments: replies }
  })

  async function look(saved: BitbucketRepositoryCheckState, now: number) {
    const reply = await lookAtBitbucketServerComments(REPO, baseUrl, saved, now)
    if (!reply.ok) {
      throw new Error(reply.error)
    }
    return reply.value
  }

  it('starts from the first look, then finds each new comment once, replies included', async () => {
    const old = commented(10, '@orca review', T0 - 3_600_000)
    pullRequests = [
      {
        id: 7,
        title: 'Add retries',
        updatedDate: T0 - 3_600_000,
        reviewers: [],
        properties: { commentCount: 1 },
        activities: [old]
      }
    ]
    const saved: BitbucketRepositoryCheckState = {}

    const first = await look(saved, T0)
    first.finish()
    expect(first.comments).toEqual([])
    expect(activityReads).toEqual([])

    // Nothing moved: the pull request is not read again.
    const quiet = await look(saved, T0 + 60_000)
    quiet.finish()
    expect(activityReads).toEqual([])

    const reply = {
      id: 12,
      text: '@orca review',
      author: { name: 'sam' },
      createdDate: T0 + 90_000
    }
    pullRequests[0].activities = [{ ...old, comment: { ...old.comment, comments: [reply] } }]
    pullRequests[0].properties.commentCount = 2
    const second = await look(saved, T0 + 120_000)
    expect(second.comments.map((comment) => [comment.id, comment.author?.id])).toEqual([
      [12, 'sam']
    ])
    expect(second.comments[0].pullRequestUrl).toBe(
      `${baseUrl}/projects/prj/repos/api/pull-requests/7`
    )

    // A look that stops before finishing reads the pull request again and still skips what it handled.
    const retried = await look(saved, T0 + 180_000)
    expect(retried.comments.map((comment) => comment.id)).toEqual([12])
    retried.handled(retried.comments[0])
    const afterHandled = await look(saved, T0 + 240_000)
    expect(afterHandled.comments).toEqual([])
    afterHandled.finish()

    const settled = await look(saved, T0 + 300_000)
    expect(settled.comments).toEqual([])
    expect(activityReads).toEqual([7, 7, 7])
  })

  it('lists the open pull requests that ask the account to review', async () => {
    pullRequests = [7, 8].map((id) => ({
      id,
      title: `PR ${id}`,
      updatedDate: T0,
      reviewers: id === 8 ? [{ user: { name: 'Orca-Bot' } }] : [],
      properties: { commentCount: 0 },
      activities: []
    }))
    const reply = await listBitbucketServerReviewRequests(REPO, baseUrl, 'orca-bot')
    expect(reply.ok && reply.value.map((pullRequest) => pullRequest.id)).toEqual([8])
  })
})
