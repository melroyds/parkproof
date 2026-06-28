import { Component, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'

/**
 * Top-level error boundary. ParkProof has a documented history of full-tree
 * render crashes (see CLAUDE.md, commit 2db84b8) that blanked the whole app to
 * a white screen with no recovery. A boundary turns that worst case into a
 * friendly, reloadable fallback for a stressed user standing at a sign.
 *
 * The fallback is a small function component so it can use the i18n hook; the
 * class only catches. A render crash inside the fallback itself can't be
 * caught here, so the fallback is deliberately trivial.
 */
function ErrorFallback() {
  const { t } = useTranslation()
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto">
      <div className="w-16 h-16 rounded-full bg-accent-100 border-2 border-accent-500 text-accent-700 flex items-center justify-center mb-4">
        <Icon name="warning" className="w-8 h-8" />
      </div>
      <h2 className="font-display text-2xl font-extrabold text-ink-900">
        {t('errors.boundaryTitle')}
      </h2>
      <p className="text-sm text-ink-700 mt-3 mb-6 leading-relaxed">
        {t('errors.boundaryBody')}
      </p>
      <button
        onClick={() => window.location.reload()}
        className="bg-gradient-to-r from-brand-500 via-brand-500 to-purple-600 hover:brightness-110 active:brightness-95 text-white font-semibold py-3 px-6 rounded-2xl shadow-md transition-colors"
      >
        {t('errors.boundaryReload')}
      </button>
    </main>
  )
}

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, info: unknown) {
    // Make crashes observable in the console (and any future telemetry hook)
    // rather than failing silently to a blank screen.
    console.error('[boundary] render crash:', error, info)
  }

  render() {
    if (this.state.hasError) return <ErrorFallback />
    return this.props.children
  }
}
