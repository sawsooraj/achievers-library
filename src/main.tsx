import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ErrorBoundary } from './ErrorBoundary'
import { SkipToMainContent } from './AccessibilityHelpers'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <SkipToMainContent />
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
