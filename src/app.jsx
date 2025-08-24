import React, { useState } from 'react'
import UploadIndex from './components/UploadIndex'
import Chat from './components/Chat'
import useMathJax from './hooks/useMathJax'

export default function App(){
  // load MathJax once for the app (v3 CDN)
  useMathJax()

  const [collection, setCollection] = useState(null)

  return (
    <div className="app-root dark">
      <header className="topbar">
        <h1>DocuMind</h1>
        <p className="sub">Local PDF Chat — frontend demo (MathJax-first)</p>
      </header>

      <main className="container">
        <section className="left">
          <UploadIndex onIndexed={(name)=>setCollection(name)} />
        </section>
        <section className="right">
          <Chat collection={collection} />
        </section>
      </main>

      <footer className="footer">DocuMind</footer>
    </div>
  )
}