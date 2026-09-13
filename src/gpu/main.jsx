import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './gpu.css'
import GpuPage from './GpuPage.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <GpuPage />
  </StrictMode>,
)
