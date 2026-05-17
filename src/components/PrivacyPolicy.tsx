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
  return (
    <div className="min-h-screen flex flex-col p-6 max-w-2xl mx-auto w-full">
      <button onClick={onBack} className="self-start text-ink-600 hover:text-ink-900 text-sm mb-4">
        ← Back
      </button>

      <h2 className="font-display text-3xl font-extrabold text-ink-900 mb-1">Privacy</h2>
      <p className="text-sm text-ink-600 mb-6 leading-relaxed">
        Last updated: {new Date().toLocaleDateString('en-AU', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
      </p>

      <article className="prose space-y-4 text-sm text-ink-800 leading-relaxed">
        <Section title="What you give us when you use ParkProof without an account">
          <p>
            ParkProof works fully anonymously by default. We do not require sign-in,
            we do not record an account, and the parking sessions you log live in
            your own browser's <code className="font-mono text-xs">localStorage</code>.
            They never leave your device.
          </p>
          <p>
            Three things do leave your device, even in anonymous mode:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Sign photos + GPS coordinates</strong> are sent to{' '}
              <strong>Anthropic</strong> (Claude vision) to translate the sign. We
              don't store them server-side; Anthropic's retention policy applies.
            </li>
            <li>
              <strong>GPS coordinates</strong> are sent to{' '}
              <strong>OpenStreetMap Nominatim</strong> to resolve the street address.
              Nominatim does not require a key and applies their public retention policy.
            </li>
            <li>
              <strong>A random per-result UUID</strong> + a "correct / retake" verdict
              are logged to <strong>AWS CloudWatch</strong> when you tap the verification
              card. No PII; aggregate signal for prompt tuning.
            </li>
          </ul>
        </Section>

        <Section title="What you give us when you sign in">
          <p>
            Signing in is optional. It enables cloud sync — the same sessions
            visible across all your devices.
          </p>
          <p>When you sign in, additional data leaves your device:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              Your <strong>email address</strong> — stored in AWS Cognito; used as your
              account identifier and for password reset.
            </li>
            <li>
              Every <strong>parking session</strong> you save — stored in AWS DynamoDB,
              keyed to your Cognito user ID. Includes timestamps, GPS, sign rules,
              the AI's translation, your notes, and the cryptographic signature.
            </li>
            <li>
              Every <strong>photo</strong> attached to a session — stored in AWS S3
              under a path that includes your user ID, accessible only to you while
              signed in.
            </li>
          </ul>
        </Section>

        <Section title="Where the data lives">
          <p>
            All cloud storage is in <strong>AWS Sydney (ap-southeast-2)</strong>.
            Data does not leave Australia for storage purposes. Anthropic and
            Nominatim may process data internationally during a single API call;
            those calls do not persist.
          </p>
        </Section>

        <Section title="What we don't do">
          <ul className="list-disc pl-6 space-y-1">
            <li>We don't sell your data, ever.</li>
            <li>We don't share it with third parties beyond the AWS, Anthropic and Nominatim flows above.</li>
            <li>We don't use it for advertising. ParkProof has no ads.</li>
            <li>We don't track you across other sites.</li>
            <li>We don't run analytics that fingerprint your device.</li>
          </ul>
        </Section>

        <Section title="Your rights">
          <p>
            If you sign in:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Export.</strong> Tap "Download as PDF" in Account to get
              a complete document with every session you've stored — cover
              page summary plus a per-session detail block with photos.
            </li>
            <li>
              <strong>Delete.</strong> Tap "Delete account" in Account. Removes
              your sign-in record, every DynamoDB row, and every S3 photo within
              seconds. Irreversible.
            </li>
            <li>
              <strong>Correct.</strong> You edit your sessions in-app — every change
              syncs to the cloud immediately if signed in.
            </li>
          </ul>
          <p>
            If you don't sign in, all your data is on your device — clear your
            browser storage to delete it.
          </p>
        </Section>

        <Section title="Photos taken inside ParkProof">
          <p>
            Photos are resized to ≤1200px and re-encoded as JPEG at 0.82 quality
            on your device before they leave the browser. The original
            high-resolution camera capture never leaves your phone.
          </p>
        </Section>

        <Section title="Cryptographic signing">
          <p>
            When you sign in (or stay anonymous — both work), each session is
            signed by an AWS KMS-managed ECDSA P-256 key. The private key never
            leaves AWS. The public key is published at{' '}
            <a
              href="/parkproof-public-key.pem"
              className="text-brand-700 hover:text-brand-800 underline break-all"
            >
              /parkproof-public-key.pem
            </a>{' '}
            for anyone (a council, court, insurer) to verify the evidence chain
            using <code className="font-mono text-xs">openssl dgst</code> — see the
            appendix in any exported PDF for the step-by-step.
          </p>
        </Section>

        <Section title="Contact + complaints">
          <p>
            For questions or to exercise your rights outside of the in-app
            controls, email{' '}
            <a href="mailto:melroy@dsouza.tech" className="text-brand-700 underline">
              melroy@dsouza.tech
            </a>.
          </p>
          <p>
            Unhappy with our response? You can complain to the{' '}
            <a
              href="https://www.oaic.gov.au/"
              target="_blank"
              rel="noreferrer"
              className="text-brand-700 underline"
            >
              Office of the Australian Information Commissioner (OAIC)
            </a>.
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
