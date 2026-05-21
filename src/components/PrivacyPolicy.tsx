import { Trans, useTranslation } from 'react-i18next'

interface Props {
  onBack: () => void
}

/**
 * Plain-English privacy policy, in-app. Renders the same content whether
 * the user is signed in or not (anonymous mode still uses Claude + Nominatim).
 *
 * Update when the data flow changes — this is the source of truth users see,
 * not a separate marketing page.
 */
export default function PrivacyPolicy({ onBack }: Props) {
  const { t } = useTranslation()
  const formattedDate = new Date().toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-2xl mx-auto w-full">
      <button onClick={onBack} className="self-start text-ink-600 hover:text-ink-900 text-sm mb-4">
        {t('common.back')}
      </button>

      <h2 className="font-display text-3xl font-extrabold text-ink-900 mb-1">{t('privacy.header')}</h2>
      <p className="text-sm text-ink-600 mb-6 leading-relaxed">
        {t('privacy.lastUpdated', { date: formattedDate })}
      </p>

      <article className="prose space-y-4 text-sm text-ink-800 leading-relaxed">
        <Section title={t('privacy.anonymousHeader')}>
          <p>
            <Trans
              i18nKey="privacy.anonymousIntro"
              components={{ code: <code className="font-mono text-xs" /> }}
            />
          </p>
          <p>{t('privacy.anonymousThings')}</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <Trans i18nKey="privacy.anonymousAnthropic" components={{ strong: <strong /> }} />
            </li>
            <li>
              <Trans i18nKey="privacy.anonymousNominatim" components={{ strong: <strong /> }} />
            </li>
            <li>
              <Trans i18nKey="privacy.anonymousCloudwatch" components={{ strong: <strong /> }} />
            </li>
          </ul>
        </Section>

        <Section title={t('privacy.signedInHeader')}>
          <p>{t('privacy.signedInIntro')}</p>
          <p>{t('privacy.signedInThings')}</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <Trans i18nKey="privacy.signedInEmail" components={{ strong: <strong /> }} />
            </li>
            <li>
              <Trans i18nKey="privacy.signedInSessions" components={{ strong: <strong /> }} />
            </li>
            <li>
              <Trans i18nKey="privacy.signedInPhotos" components={{ strong: <strong /> }} />
            </li>
          </ul>
        </Section>

        <Section title={t('privacy.locationHeader')}>
          <p>
            <Trans i18nKey="privacy.locationCopy" components={{ strong: <strong /> }} />
          </p>
        </Section>

        <Section title={t('privacy.dontHeader')}>
          <ul className="list-disc pl-6 space-y-1">
            <li>{t('privacy.dontSell')}</li>
            <li>{t('privacy.dontShare')}</li>
            <li>{t('privacy.dontAds')}</li>
            <li>{t('privacy.dontTrack')}</li>
            <li>{t('privacy.dontFingerprint')}</li>
          </ul>
        </Section>

        <Section title={t('privacy.rightsHeader')}>
          <p>{t('privacy.rightsSignedIn')}</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <Trans i18nKey="privacy.rightsExport" components={{ strong: <strong /> }} />
            </li>
            <li>
              <Trans i18nKey="privacy.rightsDelete" components={{ strong: <strong /> }} />
            </li>
            <li>
              <Trans i18nKey="privacy.rightsCorrect" components={{ strong: <strong /> }} />
            </li>
          </ul>
          <p>{t('privacy.rightsAnonymous')}</p>
        </Section>

        <Section title={t('privacy.photosHeader')}>
          <p>{t('privacy.photosCopy')}</p>
        </Section>

        <Section title={t('privacy.signingHeader')}>
          <p>
            <Trans
              i18nKey="privacy.signingCopy"
              components={{
                a: (
                  <a
                    href="/parkproof-public-key.pem"
                    className="text-brand-700 hover:text-brand-800 underline break-all"
                  />
                ),
                code: <code className="font-mono text-xs" />,
              }}
            />
          </p>
        </Section>

        <Section title={t('privacy.contactHeader')}>
          <p>
            <Trans
              i18nKey="privacy.contactCopy"
              components={{
                a: <a href="mailto:hello@parkproof.com.au" className="text-brand-700 underline" />,
              }}
            />
          </p>
          <p>
            <Trans
              i18nKey="privacy.complaintCopy"
              components={{
                a: (
                  <a
                    href="https://www.oaic.gov.au/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand-700 underline"
                  />
                ),
              }}
            />
          </p>
        </Section>
      </article>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-display text-lg font-bold text-ink-900 mb-2 mt-6 first:mt-0">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  )
}
