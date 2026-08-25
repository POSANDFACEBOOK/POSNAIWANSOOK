import React from 'react'
import ReactDOM from 'react-dom/client'
import FoodCostApp from './FoodCostApp.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'

// ErrorBoundary ครอบทั้งแอป — error ที่หลุดมาถึงตรงนี้จะได้เห็นข้อความ
// พร้อมปุ่มโหลดใหม่ แทนที่จะเป็นจอขาวเปล่าๆ ที่พนักงานทำอะไรไม่ได้เลย
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <FoodCostApp />
    </ErrorBoundary>
  </React.StrictMode>
)
