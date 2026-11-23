// A client from before Gmail, Calendar or Bitbucket rules counts each as a missing connector and
// throws naming it, so it gets each automation without them. Local callers and newer clients see all.
import {
  BITBUCKET_TRIGGERS_RUNTIME_CAPABILITY,
  isBitbucketTrigger
} from '../../../shared/automation-bitbucket-triggers'
import { isGoogleTrigger } from '../../../shared/automation-google-triggers'
import type { Automation } from '../../../shared/automations/automation-definition'
import { GOOGLE_TRIGGERS_RUNTIME_CAPABILITY } from '../../../shared/google/google-connect-types'
import type { RpcContext } from './core'

type Client = Pick<RpcContext, 'clientCapabilities'>

const reads = (context: Client, capability: string): boolean =>
  context.clientCapabilities === undefined || context.clientCapabilities.includes(capability)

export function readsHostCheckedRules(context: Client): boolean {
  return (
    reads(context, GOOGLE_TRIGGERS_RUNTIME_CAPABILITY) &&
    reads(context, BITBUCKET_TRIGGERS_RUNTIME_CAPABILITY)
  )
}

export function automationForClient<A extends Pick<Automation, 'on'>>(
  automation: A,
  context: Client
): A {
  const google = reads(context, GOOGLE_TRIGGERS_RUNTIME_CAPABILITY)
  const bitbucket = reads(context, BITBUCKET_TRIGGERS_RUNTIME_CAPABILITY)
  const on = automation.on?.filter(
    (rule) => (google || !isGoogleTrigger(rule)) && (bitbucket || !isBitbucketTrigger(rule))
  )
  return on && on.length !== automation.on?.length ? { ...automation, on } : automation
}
