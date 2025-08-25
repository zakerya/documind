// src/app.jsx
import React, { useState } from 'react'
import Chat from './components/Chat.jsx'
import UploadIndex from './components/UploadIndex.jsx'
import useMathJax from './hooks/useMathJax.js'
import './index.css'

export default function App() {
  const [collection, setCollection] = useState('')
  useMathJax()

  return (
    <div className="app-root">
      <div className="topbar">
        <h1>DocuMind</h1>
        <p className="sub">AI-powered PDF assistant</p>
      </div>
      
      <div className="container">
        {!collection ? (
          <div className="centered-content">
            <UploadIndex onIndexed={setCollection} />
          </div>
        ) : (
          <>
            <div className="left">
              <UploadIndex onIndexed={setCollection} />
            </div>
            <div className="right">
              <Chat collection={collection} />
            </div>
          </>
        )}
      </div>
      
      <div className="footer">
        DocuMind - AI-powered PDF assistant
      </div>
    </div>
  )
}