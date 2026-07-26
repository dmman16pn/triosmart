import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, useLocation } from 'react-router-dom'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { ToastProvider } from './ui.jsx'
import './styles.css'

function Root() {
  const location = useLocation()
  return (
    <ErrorBoundary locationKey={location.key}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  )
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </React.StrictMode>
)
