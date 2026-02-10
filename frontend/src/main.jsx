import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  // ปิด StrictMode ชั่วคราวเพื่อป้องกัน double render ใน development
  // <StrictMode>
    <App />
  // </StrictMode>
)
