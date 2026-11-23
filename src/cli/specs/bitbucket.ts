import type { CommandSpec } from '../discovery/command-spec'
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'

const HOST_FLAGS = ['server', 'cloud']
const PULL_REQUEST_FLAGS = [...GLOBAL_FLAGS, 'url', 'repo', 'pr', ...HOST_FLAGS]
const PULL_REQUEST = '(<url> | --repo <workspace>/<repository> --pr <id> [--server | --cloud])'
const HOST_NOTE =
  '--repo is <workspace>/<repository> on bitbucket.org, or <PROJECT>/<repository> on the connected Data Center server; with both connected, add --server or --cloud. A URL names its own host.'
const EXAMPLE_URL = 'https://bitbucket.org/acme/api/pull-requests/42'

export const BITBUCKET_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['bitbucket', 'connection'],
    summary: "Show this host's saved Bitbucket connections",
    usage: 'orca bitbucket connection [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: ['Reports saved connections, not verified access to a repository.']
  },
  {
    path: ['bitbucket', 'pr', 'list'],
    summary: 'List pull requests of a Bitbucket repository',
    usage:
      'orca bitbucket pr list --repo <workspace>/<repository> [--server | --cloud] [--state open|merged|declined|superseded|all] [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'state', 'limit', ...HOST_FLAGS],
    booleanFlags: HOST_FLAGS,
    notes: [HOST_NOTE],
    examples: ['orca bitbucket pr list --repo acme/api --json']
  },
  {
    path: ['bitbucket', 'pr', 'view'],
    summary: 'Read a Bitbucket pull request',
    usage: `orca bitbucket pr view ${PULL_REQUEST} [--json]`,
    allowedFlags: PULL_REQUEST_FLAGS,
    booleanFlags: HOST_FLAGS,
    positionalArgs: ['url'],
    examples: [
      `orca bitbucket pr view ${EXAMPLE_URL} --json`,
      'orca bitbucket pr view --repo acme/api --pr 42',
      'orca bitbucket pr view https://git.example.com/projects/API/repos/server/pull-requests/42'
    ]
  },
  {
    path: ['bitbucket', 'pr', 'diff'],
    summary: "Print a Bitbucket pull request's diff",
    usage: `orca bitbucket pr diff ${PULL_REQUEST} [--path <file>] [--json]`,
    allowedFlags: [...PULL_REQUEST_FLAGS, 'path'],
    booleanFlags: HOST_FLAGS,
    positionalArgs: ['url'],
    notes: [
      'A large diff is cut short and marked truncated; pass --path for one file, or diff the branches with git.'
    ],
    examples: [`orca bitbucket pr diff ${EXAMPLE_URL} --path src/server.ts`]
  },
  {
    path: ['bitbucket', 'pr', 'comment', 'list'],
    summary: 'List the comments on a Bitbucket pull request',
    usage: `orca bitbucket pr comment list ${PULL_REQUEST} [--json]`,
    allowedFlags: PULL_REQUEST_FLAGS,
    booleanFlags: HOST_FLAGS,
    positionalArgs: ['url'],
    examples: [`orca bitbucket pr comment list ${EXAMPLE_URL} --json`]
  },
  {
    path: ['bitbucket', 'pr', 'comment', 'add'],
    summary: 'Comment on a Bitbucket pull request',
    usage: `orca bitbucket pr comment add ${PULL_REQUEST} (--body <text> | --body-file <path|->) [--file <path> --line <n> [--side new|old] | --parent <commentId>] [--json]`,
    allowedFlags: [...PULL_REQUEST_FLAGS, 'body', 'body-file', 'file', 'line', 'side', 'parent'],
    booleanFlags: HOST_FLAGS,
    positionalArgs: ['url'],
    notes: [
      '--file with --line places the comment on that line of the changed file; --side old targets a removed line.',
      '--parent replies in an existing thread.'
    ],
    examples: [
      `orca bitbucket pr comment add ${EXAMPLE_URL} --body-file review-summary.md`,
      `orca bitbucket pr comment add ${EXAMPLE_URL} --file src/server.ts --line 88 --body "This handler never closes the socket."`
    ]
  }
]
