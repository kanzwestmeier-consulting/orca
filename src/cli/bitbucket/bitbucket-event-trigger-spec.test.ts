import { describe, expect, it } from 'vitest'
import { AutomationEventTriggers } from '../../shared/rpc-contract/automation-bot-params'
import {
  formatAutomationEventTrigger,
  parseAutomationEventTrigger
} from '../automations/automation-event-trigger-spec'

describe('Bitbucket --on rules', () => {
  it('reads a rule into one spelling and writes the same rule back', () => {
    const rule = parseAutomationEventTrigger(
      'bitbucket.mentioned repos=acme/API,acme/web,acme/api mention="@orca review" from=712020:b,712020:a'
    )
    expect(rule).toEqual({
      id: rule.id,
      source: 'bitbucket',
      event: 'mentioned',
      repos: ['acme/api', 'acme/web'],
      mention: '@orca review',
      from: ['712020:a', '712020:b']
    })
    const written = formatAutomationEventTrigger(rule)
    expect(written).toBe(
      'bitbucket.mentioned repos=acme/api,acme/web mention="@orca review" from=712020:a,712020:b'
    )
    expect(parseAutomationEventTrigger(written)).toEqual(rule)
  })

  it('writes rules the host accepts when they are saved', () => {
    const rules = [
      parseAutomationEventTrigger('bitbucket.mentioned repos=acme/api mention="@orca review"'),
      parseAutomationEventTrigger('bitbucket.review_requested repos=acme/api from=712020:a')
    ]
    expect(AutomationEventTriggers.parse(rules)).toEqual(rules)
  })

  it('refuses a rule that names no repository, or something that is not one', () => {
    expect(() => parseAutomationEventTrigger('bitbucket.mentioned')).toThrow(/needs repos=/)
    expect(() => parseAutomationEventTrigger('bitbucket.review_requested repos=acme')).toThrow(
      /not a Bitbucket repository/
    )
    expect(() =>
      parseAutomationEventTrigger('bitbucket.review_requested repos=acme/api mention=@orca')
    ).toThrow(/Unknown filter "mention="/)
  })
})
