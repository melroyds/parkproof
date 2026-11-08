// @vitest-environment happy-dom
//
// The PDF signature appendix never presents a `npm run dev` signature
// (key_alias 'dev-ephemeral') as a ParkProof signature: it opens with the
// dev-key line instead (spec N2).
import { beforeAll, describe, expect, it } from 'vitest'
import i18n from './i18n'
import { devKeyNotice } from './pdf'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

describe('devKeyNotice', () => {
  it('opens the appendix with the dev-key line for a dev-ephemeral bundle', () => {
    expect(devKeyNotice({ key_alias: 'dev-ephemeral' }, i18n.t)).toBe(
      "Signed with a development key. It can't be checked with ParkProof's published key.",
    )
  })

  it('adds nothing for a bundle signed with the published key', () => {
    expect(devKeyNotice({ key_alias: 'alias/parkproof-evidence-signing' }, i18n.t)).toBeNull()
  })
})
