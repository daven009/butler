import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

interface ErrorBoundaryState {
  error: Error | null
  info: ErrorInfo | null
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] React render crash:', error)
    console.error('[ErrorBoundary] componentStack:', info.componentStack)
    this.setState({ error, info })
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 24,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          background: '#fff5f7',
          color: '#c13515',
          minHeight: '100vh',
          fontSize: 13,
          lineHeight: 1.6,
        }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>
            ⚠️ React render crashed
          </h1>
          <p><b>{this.state.error.name}:</b> {this.state.error.message}</p>
          <pre style={{ whiteSpace: 'pre-wrap', marginTop: 12, padding: 12, background: '#fff', borderRadius: 8, border: '1px solid #ffd5de', overflow: 'auto' }}>
            {this.state.error.stack}
          </pre>
          {this.state.info?.componentStack && (
            <pre style={{ whiteSpace: 'pre-wrap', marginTop: 12, padding: 12, background: '#fff', borderRadius: 8, border: '1px solid #ffd5de', overflow: 'auto' }}>
              Component stack:{this.state.info.componentStack}
            </pre>
          )}
          <button
            onClick={() => this.setState({ error: null, info: null })}
            style={{ marginTop: 16, padding: '8px 16px', background: '#222', color: '#fff', border: 0, borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}
          >
            Dismiss & try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// Global handlers — also catch async/unhandled errors that ErrorBoundary misses
window.addEventListener('error', (e) => {
  console.error('[window.error]', e.error || e.message, e)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', e.reason)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
