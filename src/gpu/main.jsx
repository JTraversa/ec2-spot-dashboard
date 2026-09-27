import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../tokens.css'
import './gpu.css'
import GpuPage from './GpuPage.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <GpuPage />
  </StrictMode>,
)
