import React, { useState, useEffect, useRef } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

export default function Chat({ collection }){
  const [q, setQ] = useState('')
  const [answerHtml, setAnswerHtml] = useState('<p>No answer yet</p>')
  const [sources, setSources] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const answerRef = useRef(null)

  useEffect(()=>{
    if(window.docuMindTypeset && answerRef.current){
      // typeset when content changes
      window.docuMindTypeset(answerRef.current).catch(()=>{})
    }
  }, [answerHtml, sources])

  // Check if backend is available
  const checkBackend = async () => {
    try {
      const response = await fetch('http://localhost:5000/api/health')
      return response.ok
    } catch (error) {
      console.error('Backend not available:', error)
      return false
    }
  }

  async function ask(){
    if(!collection){
      setAnswerHtml('<p><em>Index a PDF first.</em></p>')
      return
    }
    
    setIsLoading(true)
    setAnswerHtml('<p>Thinking…</p>')

    // Check if backend is available
    const backendAvailable = await checkBackend()
    if (!backendAvailable) {
      setAnswerHtml('<p>Backend server is not running. Please start the Flask backend or use the "Demo local" button.</p>')
      setIsLoading(false)
      return
    }

    try{
      const payload = { question: q, collection }
      const resp = await fetch('http://localhost:5000/api/chat', {
        method: 'POST', 
        headers: {'Content-Type': 'application/json'}, 
        body: JSON.stringify(payload)
      })
      
      if (!resp.ok) {
        throw new Error(`Server returned ${resp.status}: ${resp.statusText}`)
      }
      
      const data = await resp.json()

      // Check if there's an error in the response
      if (data.error) {
        setAnswerHtml(`<p>Backend error: ${DOMPurify.sanitize(data.error)}</p>`)
        return
      }

      // handle the structured JSON response (preferred)
      if(data && (data.answer_markdown !== undefined)){
        let md = data.answer_markdown
        const mathList = data.math_expressions || []
        // replace placeholders <<MATH_n>> with \( ... \) or \[ ... \]
        mathList.forEach((m, i)=>{
          const preferDisplay = m.length>80 || m.includes('\n')
          const wrapped = preferDisplay ? `\\[${m}\\]` : `\\(${m}\\)`
          md = md.split(`<<MATH_${i}>>`).join(wrapped)
        })
        const html = marked.parse(md)
        const clean = DOMPurify.sanitize(html)
        setAnswerHtml(clean)
        setSources(data.sources_markdown || '')
        return
      }

      // fallback: backend returns raw markdown text
      if(typeof data === 'string'){
        const html = marked.parse(data)
        setAnswerHtml(DOMPurify.sanitize(html))
        return
      }

      // fallback: unknown shape
      setAnswerHtml('<p>Unexpected backend response. See console.</p>')
      console.log('backend response', data)
    }catch(e){
      console.error('Request failed:', e)
      setAnswerHtml(`<p>Request failed: ${DOMPurify.sanitize(e.message)}. Make sure your backend is running on port 5000.</p>`)
    } finally {
      setIsLoading(false)
    }
  }

  // locally-prepared demo renderer (if backend absent) — uses localStorage chunks
  async function demoLocalAnswer(){
    if(!collection){ setAnswerHtml('<p>Index a PDF first (demo mode).</p>'); return }
    const stored = localStorage.getItem('documind:'+collection)
    if(!stored){ setAnswerHtml('<p>No local index found.</p>'); return }
    const parsed = JSON.parse(stored)
    // naive retrieval: find first chunk with most overlapping words
    const qwords = (q||'').toLowerCase().split(/\W+/).filter(Boolean)
    const scores = parsed.chunks.map((c,i)=>{
      const cnt = qwords.reduce((s,w)=> s + (c.text.toLowerCase().includes(w)?1:0), 0)
      return {i,score:cnt}
    }).sort((a,b)=>b.score-a.score)
    const best = scores.slice(0,3).filter(x=>x.score>0)
    if(best.length===0){ setAnswerHtml('<p>No relevant context found in local index.</p>'); return }
    const mdParts = best.map(b=>`**(page ${parsed.chunks[b.i].page})**\n\n${parsed.chunks[b.i].text}`)
    const md = `**Local demo answer — sources below**\n\n${mdParts.join('\n\n---\n\n')}`
    setAnswerHtml(DOMPurify.sanitize(marked.parse(md)))
  }

  return (
    <div className="card">
      <h2>Chat</h2>
      <div className="helper">Collection: <strong>{collection || '—'}</strong></div>
      <textarea 
        value={q} 
        onChange={e=>setQ(e.target.value)} 
        rows={4} 
        placeholder="Ask something about the indexed textbook..."
        disabled={isLoading}
      ></textarea>
      <div className="row">
        <button onClick={ask} disabled={!collection || isLoading}>
          {isLoading ? 'Asking...' : 'Ask (backend)'}
        </button>
        <button onClick={demoLocalAnswer} disabled={isLoading}>
          Demo local
        </button>
      </div>

      <div className="answer documind-card">
        <div ref={answerRef} dangerouslySetInnerHTML={{__html: answerHtml}} />
      </div>

      <div className="sources documind-card" style={{marginTop:12}}>
        <h4>Sources</h4>
        <div dangerouslySetInnerHTML={{__html: marked.parse(sources||'No sources.')}} />
      </div>
    </div>
  )
}