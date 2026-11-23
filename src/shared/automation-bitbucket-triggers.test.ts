import { describe, expect, it } from 'vitest'
import { bitbucketTextMentions } from './automation-bitbucket-triggers'

describe('bitbucketTextMentions', () => {
  it('finds the phrase standing alone, in any case', () => {
    expect(
      ['@orca review', 'Please, @Orca: take a look', '(@orca)', 'line one\n@ORCA'].map((text) =>
        bitbucketTextMentions(text, '@orca')
      )
    ).toEqual([true, true, true, true])
  })

  it('does not take a longer name, an email address or a quoted line for the phrase', () => {
    expect(
      ['@orcabot review', 'mail dev@orca.io', 'x@orca', '> @orca review\nthanks', '@orca-ci'].map(
        (text) => bitbucketTextMentions(text, '@orca')
      )
    ).toEqual([false, false, false, false, false])
  })

  it('matches a phrase of several words whatever the spacing, and only whole', () => {
    expect(bitbucketTextMentions('@orca   review this', '@orca review')).toBe(true)
    expect(bitbucketTextMentions('@orca reviewer', '@orca review')).toBe(false)
    expect(bitbucketTextMentions('anything', '  ')).toBe(false)
  })
})
