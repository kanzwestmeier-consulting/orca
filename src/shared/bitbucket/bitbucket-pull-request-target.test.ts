import { describe, expect, it } from 'vitest'
import {
  parseBitbucketPullRequestId,
  parseBitbucketPullRequestUrl,
  parseBitbucketRepositoryInput,
  parseBitbucketServerPullRequestUrl,
  parseBitbucketServerRepositoryInput
} from './bitbucket-pull-request-target'

describe('parseBitbucketPullRequestUrl', () => {
  it('reads the repository and number from any page of a pull request', () => {
    const target = { workspace: 'acme', repoSlug: 'api.server', id: 42, dialect: 'cloud' }
    expect(
      parseBitbucketPullRequestUrl('https://bitbucket.org/acme/api.server/pull-requests/42')
    ).toEqual(target)
    expect(
      parseBitbucketPullRequestUrl(
        ' https://www.bitbucket.org/acme/api.server/pull-requests/42/diff#comment-7 '
      )
    ).toEqual(target)
  })

  it('refuses other hosts, other pages and paths that would escape the repository', () => {
    for (const input of [
      'https://bitbucket.org.evil.example/acme/api/pull-requests/42',
      'https://evil.example/bitbucket.org/acme/api/pull-requests/42',
      'ssh://bitbucket.org/acme/api/pull-requests/42',
      'https://bitbucket.org/acme/api/branches/42',
      'https://bitbucket.org/acme/api/pull-requests/0',
      'https://bitbucket.org/acme/api/pull-requests/42abc',
      'https://bitbucket.org/acme/%2e%2e/pull-requests/42',
      'https://bitbucket.org/acme/a%2Fb/pull-requests/42',
      'acme/api#42'
    ]) {
      expect(parseBitbucketPullRequestUrl(input), input).toBeNull()
    }
  })
})

describe('parseBitbucketRepositoryInput', () => {
  it('reads workspace/repository and repository URLs', () => {
    const repository = { workspace: 'acme', repoSlug: 'api' }
    expect(parseBitbucketRepositoryInput('acme/api')).toEqual(repository)
    expect(parseBitbucketRepositoryInput('https://bitbucket.org/acme/api.git')).toEqual(repository)
    expect(parseBitbucketRepositoryInput('https://bitbucket.org/acme/api/src/main/')).toEqual(
      repository
    )
  })

  it('refuses anything that is not exactly two slug segments', () => {
    for (const input of [
      'acme',
      'acme/api/extra',
      'acme/..',
      '../api',
      'acme/a b',
      'acme/',
      '/api'
    ]) {
      expect(parseBitbucketRepositoryInput(input), input).toBeNull()
    }
  })
})

describe('parseBitbucketPullRequestId', () => {
  it('takes a positive whole number, with or without #', () => {
    expect(parseBitbucketPullRequestId('#42')).toBe(42)
    expect(parseBitbucketPullRequestId(' 7 ')).toBe(7)
    for (const input of ['0', '-1', '4.2', '1e3', '42/../7', '']) {
      expect(parseBitbucketPullRequestId(input), input).toBeNull()
    }
  })
})

describe('parseBitbucketServerPullRequestUrl', () => {
  it('reads the server, project and number, keeping a context path', () => {
    expect(
      parseBitbucketServerPullRequestUrl(
        'https://git.example.com/bitbucket/projects/API/repos/server/pull-requests/42/diff'
      )
    ).toEqual({
      workspace: 'API',
      repoSlug: 'server',
      id: 42,
      dialect: 'server',
      serverUrl: 'https://git.example.com/bitbucket'
    })
    expect(
      parseBitbucketServerPullRequestUrl(
        'http://git.example.com:7990/users/nora/repos/sandbox/pull-requests/7'
      )
    ).toEqual({
      workspace: '~nora',
      repoSlug: 'sandbox',
      id: 7,
      dialect: 'server',
      serverUrl: 'http://git.example.com:7990'
    })
  })

  it('refuses URLs with credentials, other pages and segments that would escape the repository', () => {
    for (const input of [
      'https://user:secret@git.example.com/projects/API/repos/server/pull-requests/42',
      'https://git.example.com/projects/API/repos/server/browse',
      'https://git.example.com/projects/API/repos/%2e%2e/pull-requests/42',
      'https://git.example.com/projects/A%2FB/repos/server/pull-requests/42',
      'https://git.example.com/projects/API/repos/server/pull-requests/0',
      'ftp://git.example.com/projects/API/repos/server/pull-requests/42'
    ]) {
      expect(parseBitbucketServerPullRequestUrl(input), input).toBeNull()
    }
  })
})

describe('parseBitbucketServerRepositoryInput', () => {
  it('keeps the tilde of a personal repository', () => {
    expect(parseBitbucketServerRepositoryInput('~nora/sandbox')).toEqual({
      workspace: '~nora',
      repoSlug: 'sandbox',
      dialect: 'server'
    })
    expect(parseBitbucketServerRepositoryInput('~/sandbox')).toBeNull()
    expect(parseBitbucketServerRepositoryInput('~nora/..')).toBeNull()
  })
})
