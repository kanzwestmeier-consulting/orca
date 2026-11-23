import type { HandlerGroup } from '../dispatch/handler-group-manifest'

export const BITBUCKET_HANDLER_GROUP: HandlerGroup = {
  name: 'bitbucket',
  keys: [
    'bitbucket connection',
    'bitbucket pr list',
    'bitbucket pr view',
    'bitbucket pr diff',
    'bitbucket pr comment list',
    'bitbucket pr comment add'
  ],
  load: async () => (await import('./bitbucket.js')).BITBUCKET_HANDLERS
}
