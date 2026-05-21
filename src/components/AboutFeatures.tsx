import { useTranslation } from 'react-i18next'
import Icon, { type IconName } from './Icon'

interface Props {
  onBack: () => void
  onTryIt: () => void
}

/**
 * In-app feature showcase, in plain English. Audience: a Melburnian who
 * just landed on the app and is wondering what's in here. NOT a Reddit
 * tech-bro and NOT a hiring manager — that audience has docs/features.md
 * for the technical inventory.
 *
 * Style guide:
 *   - Sentence case headings, second person ("you / your")
 *   - One short sentence per bullet — read it aloud, if you stumble, shorten
 *   - Benefits, not features ("get a receipt for your parking spot",
 *     not "cryptographic evidence chain")
 *   - Zero acronyms (no AWS / KMS / API / JSON / etc.)
 *   - One emoji per section, used as a visual anchor, not decoration
 *
 * Headings + nav copy ARE localised (so the entry crumb makes sense in
 * each language); body content stays English — see commit message of
 * b112d9c for the reasoning.
 */
export default function AboutFeatures({ onBack, onTryIt }: Props) {
  const { t } = useTranslation()

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-2xl mx-auto w-full">
      <button
        onClick={onBack}
        className="self-start text-ink-600 hover:text-ink-900 text-sm mb-4"
      >
        {t('common.back')}
      </button>

      {/* Hero — warm, low-jargon, one paragraph */}
      <header className="mb-10">
        <h1 className="font-display text-4xl font-extrabold text-ink-900 leading-tight mb-3">
          Everything ParkProof does
        </h1>
        <p className="text-base text-ink-700 leading-relaxed max-w-prose">
          You probably came here thinking{' '}
          <em>oh, it reads parking signs</em>. It does. But while it's at it,
          we figured we'd also save the evidence in case you get a wrongful
          ticket, write the dispute letter for you if you do, and remind you
          to move your car before time runs out. Here's the friendly tour.
        </p>
      </header>

      <Section
        icon="camera"
        emoji="📸"
        title="Snap a sign, get an answer"
        lead="Point your phone at any parking sign — even the messy stacked ones with arrows and clearways."
        items={[
          "You get a clear yes or no in about 10 seconds.",
          "If the sign has different rules for different sides of the road, we'll just ask which side you're on.",
          "We check if your photo is too blurry or dark before we even ask the AI — saves you a wasted try.",
        ]}
      />

      <Section
        icon="pin"
        emoji="🧾"
        title="A receipt for your parking spot"
        lead="Every park you log saves the time, the GPS, the address, and (if you want) a photo of your car at the spot."
        items={[
          'Download the whole thing as a tidy PDF — handy if you ever need to dispute a ticket.',
          "It's signed with a digital seal so nobody can argue it was edited after the fact — not even us.",
          "Add a note about why you parked there (mum's hospital visit, Saturday market) — councils take context seriously.",
        ]}
      />

      <Section
        icon="bell"
        emoji="⏰"
        title="A nudge before time runs out"
        lead="Pick when you want to be reminded — 30 minutes before, 15, 5, whatever feels right."
        items={[
          "Drops a calendar event onto your phone so the reminder fires even if ParkProof isn't open.",
          "Shows a live countdown on the home screen — green when you've got time, amber when you're getting close, red when you really need to move.",
          'Forgot where you parked? Tap "Walk back" and your maps app shows you the way.',
        ]}
      />

      <Section
        icon="warning"
        emoji="🛑"
        title='A gentle "wait a second"'
        lead="The little checks that stop you from getting a ticket you didn't see coming."
        items={[
          "If the bay needs paying (a meter, EasyPark, PayStay), we'll ask you to tick that you've paid before saving.",
          'If the bay is reserved for disability permits, we show a clear red warning.',
          "Parked somewhere with no signs at all? You can still log it — with a photo of the surroundings to show there really weren't any.",
        ]}
      />

      <Section
        icon="list"
        emoji="✉️"
        title="Got a ticket anyway?"
        lead="Don't write the dispute letter yourself. We'll do it for you."
        items={[
          "Photograph the ticket. We'll cross-check it against what we saved when you parked.",
          'You get a draft letter to the council, plus an honest rating of how strong your case looks.',
          'Edit anything you want, then download it as a PDF with the parking record attached. Print and post, or email.',
        ]}
      />

      <Section
        icon="check"
        emoji="🌏"
        title="A few small kindnesses"
        lead="The things you shouldn't have to think about, that we've thought about for you."
        items={[
          "Free. No app store. Add it to your home screen and it works like a normal app — even when you're offline.",
          'Available in 7 languages including 中文, Tiếng Việt, Italiano, Ελληνικά, हिन्दी, and ਪੰਜਾਬੀ.',
          "Times always match the parking spot — scan in Sydney while travelling, you see Sydney times. Not your phone's home zone.",
          "You don't have to sign in to use any of this. Anonymous works fine.",
        ]}
      />

      <Section
        icon="gallery"
        emoji="☁️"
        title="Sign in if you want to"
        lead="Optional. If you do, your records follow you across devices."
        items={[
          'Sign in with email, your Apple ID, or your Google account.',
          'Every park you save mirrors to the cloud — so if your phone dies, your evidence is still there.',
          'One tap to download every record. One tap to delete every record and your account, if you change your mind.',
        ]}
      />

      {/* Closing notes — softer than "Not shipped yet" */}
      <div className="mb-8">
        <h2 className="font-display text-xl font-extrabold text-ink-900 mb-2">
          A few things still on the way
        </h2>
        <p className="text-sm text-ink-600 leading-relaxed mb-3">
          ParkProof is a work in progress. The next things we're building:
        </p>
        <ul className="space-y-1.5 text-sm text-ink-700">
          <li>• Reminders that wake your phone even when ParkProof is closed</li>
          <li>• A heatmap of which Melbourne streets are easiest to park on</li>
          <li>
            • Submitting the appeal letter directly to councils (some are blocking us — we're working on it)
          </li>
        </ul>
      </div>

      {/* Build-in-the-open footer note — small, casual */}
      <div className="mb-10 pt-4 border-t border-paper-300">
        <p className="text-xs text-ink-500 leading-relaxed">
          ParkProof is open source — every line of code is public. If you're
          curious about how it works under the hood, have a look at{' '}
          <a
            href="https://github.com/melroyds/parkproof"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-600 hover:text-brand-700 underline"
          >
            the GitHub repo
          </a>
          . Built in Melbourne by{' '}
          <a
            href="https://www.linkedin.com/in/melroyds/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-600 hover:text-brand-700 underline"
          >
            Melroy D'Souza
          </a>
          .
        </p>
      </div>

      {/* CTA back into the app */}
      <button
        onClick={onTryIt}
        className="w-full bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white text-lg font-semibold py-5 rounded-2xl shadow-lg shadow-brand-500/25 flex items-center justify-center gap-3 transition-colors mb-4"
      >
        <Icon name="camera" className="w-6 h-6" />
        Try it — scan a sign
      </button>
    </div>
  )
}

interface SectionProps {
  icon: IconName
  emoji: string
  title: string
  lead: string
  items: string[]
}

function Section({ icon, emoji, title, lead, items }: SectionProps) {
  return (
    <section className="mb-10">
      <header className="flex items-start gap-3 mb-3">
        <div className="inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-brand-50 text-brand-600 shrink-0 mt-0.5 text-xl">
          <span aria-hidden>{emoji}</span>
          <span className="sr-only">
            <Icon name={icon} className="w-5 h-5" />
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-xl font-extrabold text-ink-900 leading-tight">
            {title}
          </h2>
          <p className="text-sm text-ink-600 leading-relaxed mt-1">{lead}</p>
        </div>
      </header>
      <ul className="space-y-2 mt-3">
        {items.map((item) => (
          <li
            key={item}
            className="flex items-start gap-2 text-sm text-ink-700 leading-relaxed"
          >
            <span className="text-brand-500 shrink-0 mt-0.5" aria-hidden>
              ✓
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
