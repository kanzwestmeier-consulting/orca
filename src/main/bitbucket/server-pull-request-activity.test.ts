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
  toRef: { repository: { slug: string; project: { key: string } } }
  properties?: { commentCount: number }
  activities: unknown[]
}

const inRepository = (slug: string) => ({ repository: { slug, project: { key: 'PRJ' } } })

describe('Bitbucket Data Center trigger checks', () => {
  let server: Server
  let baseUrl = ''
  let pullRequests: FakePullRequest[] = []
  let asked: string[] = []

  beforeEach(async () => {
    pullRequests = []
    asked = []
    server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      asked.push(path.replace('/rest/api/1.0', ''))
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

  const commented = (id: number, createdDate: number, replies: unknown[] = []) => ({
    action: 'COMMENTED',
    comment: { id, text: '@orca review', author: { name: 'dana' }, createdDate, comments: replies }
  })

  async function look(saved: BitbucketRepositoryCheckState, now: number) {
    const reply = await lookAtBitbucketServerComments(REPO, baseUrl, saved, now)
    if (!reply.ok) {
      throw new Error(reply.error)
    }
    return reply.value
  }

  const activityReads = () => asked.filter((path) => path.endsWith('/activities')).length

  it('starts from the first look, then finds a new reply once even when the list shows no change', async () => {
    const old = commented(10, T0 - 3_600_000)
    // No comment count and an update time that never moves: the list gives no hint of a new comment.
    pullRequests = [
      {
        id: 7,
        title: 'Add retries',
        updatedDate: T0 - 3_600_000,
        toRef: inRepository('api'),
        activities: [old]
      }
    ]
    const saved: BitbucketRepositoryCheckState = {}

    const first = await look(saved, T0)
    first.finish()
    expect(first.comments).toEqual([])
    expect(activityReads()).toBe(0)

    // The old comment is read now, and still starts nothing.
    const quiet = await look(saved, T0 + 60_000)
    expect(quiet.comments).toEqual([])
    quiet.finish()

    const reply = {
      id: 12,
      text: '@orca review',
      author: { name: 'sam' },
      createdDate: T0 + 90_000
    }
    pullRequests[0].activities = [{ ...old, comment: { ...old.comment, comments: [reply] } }]
    const second = await look(saved, T0 + 120_000)
    expect(second.comments.map((comment) => [comment.id, comment.author?.id])).toEqual([
      [12, 'sam']
    ])
    // The server's own spelling of the project key.
    expect(second.comments[0].pullRequestUrl).toBe(
      `${baseUrl}/projects/PRJ/repos/api/pull-requests/7`
    )

    // A look that stopped before finishing reads the pull request again and skips what it handled.
    const retried = await look(saved, T0 + 180_000)
    expect(retried.comments.map((comment) => comment.id)).toEqual([12])
    retried.handled(retried.comments[0])
    const afterHandled = await look(saved, T0 + 240_000)
    expect(afterHandled.comments).toEqual([])
  })

  it("lists the repository's pull requests that ask the connected account to review", async () => {
    pullRequests = [
      { id: 7, title: 'Here', updatedDate: T0, toRef: inRepository('api'), activities: [] },
      { id: 8, title: 'Elsewhere', updatedDate: T0, toRef: inRepository('web'), activities: [] }
    ]
    const reply = await listBitbucketServerReviewRequests(REPO, baseUrl)
    expect(reply.ok && reply.value.map((pullRequest) => pullRequest.id)).toEqual([7])
    expect(asked).toEqual(['/dashboard/pull-requests'])
  })
})
