import { useTranslation } from 'react-i18next'
import Icon, { type IconName } from './Icon'

interface Props {
  onBack: () => void
  onTryIt: () => void
}

/**
 * In-app feature showcase. Solves the "users think this is just a sign
 * translator" problem — surfaces the full breadth (evidence chain, appeal
 * letters, safety gates, 7-lang i18n, opt-in sync) in one scrollable view.
 *
 * Content kept in English even on non-English locales — the showcase is
 * primarily for Reddit / HN / portfolio-link visitors landing in English.
 * The product's user-facing strings stay localised everywhere else; this
 * is one specific page with a deliberately English-only audience.
 *
 * The headings + nav copy ARE localised so that a translated app doesn't
 * suddenly hit an English-only nav crumb.
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

      {/* Hero */}
      <header className="mb-8">
        <h1 className="font-display text-4xl font-extrabold text-ink-900 leading-tight mb-3">
          Everything ParkProof does
        </h1>
        <p className="text-base text-ink-600 leading-relaxed max-w-prose">
          You probably came here thinking it's just a parking-sign translator.
          That's the headline feature — but there's a full evidence chain, an
          AI appeal-letter writer, and a few thoughtful safety gates underneath.
          Here's the full picture.
        </p>
      </header>

      <Section
        icon="camera"
        title="The core moment"
        lead="Photograph any Australian parking sign — get a plain-English verdict in 10 seconds."
        items={[
          'AI vision via Claude Sonnet 4.6 with adaptive thinking — handles stacked Melbourne CBD signs that take humans 30 seconds to parse',
          'JSON-schema-enforced output — the model literally cannot return malformed JSON',
          'Multi-rule reasoning — overlapping windows resolved correctly (earliest leave-by, never the latest)',
          'Smart clarification for position-dependent rules (arrows, side-specific bays, EV-only spots)',
          'Photo-quality pre-check — blur + brightness checks before any token spend',
        ]}
      />

      <Section
        icon="pin"
        title="Defensible evidence"
        lead="Every park you log gets a court-grade record — not just a screenshot."
        items={[
          'GPS + reverse-geocoded address + optional car photo + arrival timestamp on every session',
          'Cryptographic signing via AWS KMS ECDSA P-256 — private key never leaves AWS',
          'Public key shipped at /parkproof-public-key.pem; verify offline with one openssl command (walkthrough in every PDF)',
          'Caption-burnt photos — address + timestamp permanently rendered into the image',
          "Driver's note — 280-char free-text per session for the why (renders verbatim in the PDF)",
          'Background signing retry — sessions self-heal if signing fails mid-flight',
        ]}
      />

      <Section
        icon="calendar"
        title="Reminders & live status"
        lead="Know when to leave. Get back to your car. Never get a ticket from forgetting."
        items={[
          'Multi-offset reminder picker — 30 / 15 / 10 / 5 / 2 / 0 minutes before expiry, any combination',
          'One .ics calendar event with multiple VALARM blocks — native iOS, macOS, Google Calendar support',
          'In-tab browser notifications as backup (honestly labeled — fires only while the tab is open)',
          'Live "Currently parked" home card — countdown colour-coded by urgency',
          'Walk-back navigation — distance + ETA + deep-link to Apple Maps / Google Maps with walking mode',
          'Restriction-transition heads-up banner when a rule change is within ~3 hours',
        ]}
      />

      <Section
        icon="warning"
        title="Safety gates"
        lead="The are-you-sure checks that protect against wrongful-feeling tickets."
        items={[
          'Paid-parking gate — explicit acknowledgement required when the bay is currently in a paid window',
          'EasyPark / PayStay / Wilson / Care Park detection — recognises app-payment stickers separately from the main sign',
          'Accessibility-permit gate — RED banner + acknowledgement when the sign requires a disability permit (♿ / ACROD / Mobility Pass)',
          'No-sign mode — log a park at an unsigned spot with an ambient surroundings photo as defensible evidence',
          "Driver-signalled end-of-session — explicit \"I've left\" stamps a timestamp on the record for actual on-site duration",
        ]}
      />

      <Section
        icon="list"
        title="AI appeal letters"
        lead="You got a ticket. ParkProof writes the dispute."
        items={[
          'Photograph the infringement notice — Claude reads it, cross-references your saved session',
          'Drafts a formal letter to the issuing council, ready to send',
          'Evidence-strength rating (strong / moderate / weak) with a one-paragraph strategy note',
          'Editable in-app, exports as a polished PDF with the supporting evidence attached',
        ]}
      />

      <Section
        icon="check"
        title="Smart polish"
        lead="The small touches that separate an MVP from something actually-built-by-someone-who-cares."
        items={[
          'Smart re-scan — repeat spots within 40m / 7 days reuse the prior reading. ~3× faster, ~4× cheaper',
          'Timezone-aware everywhere — every time is in the parking spot\'s zone, resolved from GPS via tz-lookup',
          'Date-aware time labels — "Until 10:00 am, Mon 18/05/2026" so a long-window expiry never looks like today',
          'Photo resize — every photo downscaled to ≤1200px @ 0.82 JPEG before storage',
          '3-phase quota auto-recovery — strips car-photos → sign-photos → whole expired sessions before failing',
          'Stepped loading UX — real progress bar with copy tuned from CloudWatch latency data',
          'Async-polling architecture — slow Claude calls (30-50s) bypass the API Gateway 30s timeout cleanly',
        ]}
      />

      <Section
        icon="bell"
        title="Inclusion & access"
        lead="Free, no app required, every Melbourne language."
        items={[
          'PWA — installable to phone / desktop home screen, real app icon, splash, offline-capable. No app store gatekeeping',
          '7 languages: English, 简体中文, Tiếng Việt, Italiano, Ελληνικά, हिन्दी, ਪੰਜਾਬੀ',
          'Language list sourced from City of Melbourne LGA 2021 ABS Census — matches actual user demographics, not a generic global list',
          'UI scaffolding AND the evidence PDF translate; the AI\'s sign translation stays in English (reflects what\'s literally on the sign)',
          'Anonymous-by-default — every feature works without a login wall. Sign-in is opt-in for cloud sync',
          'Mobile-first — built for standing next to a pole, not a desktop',
        ]}
      />

      <Section
        icon="gallery"
        title="Cloud sync (opt-in)"
        lead="Choose to sign in — your evidence follows you across devices."
        items={[
          'Email + password sign-in via Cognito Hosted UI',
          'Apple federation — single tap with your iCloud account',
          'Google federation — single tap with your Gmail',
          'Cloud mirror — saved sessions opportunistically mirror to DynamoDB (metadata) + S3 (photos, per-user prefixes)',
          'Cross-device recovery — save on phone, view on laptop',
          'Account export — one tap dumps every saved session as a single PDF',
          'Account delete — wipes everything: DDB rows, S3 photos, Cognito user record. No retention, no soft-delete',
        ]}
      />

      {/* Open-source / built-right callout */}
      <div className="mt-4 mb-8 bg-paper-100 border border-paper-300 rounded-2xl p-5">
        <h3 className="font-display text-base font-extrabold text-ink-900 mb-1">
          Built in the open, MIT-licensed
        </h3>
        <p className="text-sm text-ink-700 leading-relaxed">
          One AWS Lambda handling 13 routes, 112 tests on CI, ~$5-7 AUD/month to run.
          The full architecture, build journal, lessons learned, and case study live at{' '}
          <a
            href="https://github.com/melroyds/parkproof"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-600 hover:text-brand-700 underline font-medium"
          >
            github.com/melroyds/parkproof
          </a>
          .
        </p>
      </div>

      {/* Honest gaps */}
      <div className="mb-10">
        <h2 className="font-display text-xl font-extrabold text-ink-900 mb-2">
          Not shipped yet
        </h2>
        <p className="text-sm text-ink-600 leading-relaxed mb-3">
          Honest about gaps — what you'd ask for is on the list.
        </p>
        <ul className="space-y-1.5 text-sm text-ink-700">
          <li>• Web Push background notifications (server-side scheduler in progress)</li>
          <li>• Citywide parking heatmap (data captured, viewer + cold-start solved next)</li>
          <li>• Voice confirmation via Web Speech API</li>
          <li>
            • Council-specific appeal auto-submission (blocked on council captchas + no public APIs)
          </li>
        </ul>
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
  title: string
  lead: string
  items: string[]
}

function Section({ icon, title, lead, items }: SectionProps) {
  return (
    <section className="mb-8">
      <header className="flex items-start gap-3 mb-2">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-brand-50 text-brand-600 shrink-0 mt-0.5">
          <Icon name={icon} className="w-5 h-5" strokeWidth={2.25} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-xl font-extrabold text-ink-900 leading-tight">
            {title}
          </h2>
          <p className="text-sm text-ink-600 leading-relaxed mt-1">{lead}</p>
        </div>
      </header>
      <ul className="space-y-2 mt-3 ml-13 pl-0">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm text-ink-700 leading-relaxed">
            <span className="text-brand-500 shrink-0 mt-0.5">✓</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
