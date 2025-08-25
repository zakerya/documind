// src/components/Chat.jsx
import React, { useState, useEffect, useRef } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

export default function Chat({ collection }){
  const [q, setQ] = useState('')
  const [messages, setMessages] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [sources, setSources] = useState('')
  const messagesEndRef = useRef(null)
  const answerRef = useRef(null)

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(()=>{
    if(window.docuMindTypeset && answerRef.current){
      window.docuMindTypeset(answerRef.current).catch(()=>{})
    }
  }, [messages, sources])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

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
      setMessages(prev => [...prev, 
        { type: 'user', content: q },
        { type: 'bot', content: '*Index a PDF first.*' }
      ])
      setQ('')
      return
    }
    
    const userMessage = q
    setMessages(prev => [...prev, { type: 'user', content: userMessage }])
    setQ('')
    setIsLoading(true)

    // Check if backend is available
    const backendAvailable = await checkBackend()
    if (!backendAvailable) {
      setMessages(prev => [...prev, 
        { type: 'bot', content: 'Backend server is not running. Please start the Flask backend.' }
      ])
      setIsLoading(false)
      return
    }

    try{
      const payload = { question: userMessage, collection }
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
        setMessages(prev => [...prev, 
          { type: 'bot', content: `Backend error: ${DOMPurify.sanitize(data.error)}` }
        ])
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
        setMessages(prev => [...prev, { type: 'bot', content: clean }])
        setSources(data.sources_markdown || '')
        return
      }

      // fallback: backend returns raw markdown text
      if(typeof data === 'string'){
        const html = marked.parse(data)
        setMessages(prev => [...prev, { type: 'bot', content: DOMPurify.sanitize(html) }])
        return
      }

      // fallback: unknown shape
      setMessages(prev => [...prev, { type: 'bot', content: 'Unexpected backend response. See console.' }])
      console.log('backend response', data)
    }catch(e){
      console.error('Request failed:', e)
      setMessages(prev => [...prev, 
        { type: 'bot', content: `Request failed: ${DOMPurify.sanitize(e.message)}. Make sure your backend is running on port 5000.` }
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      ask()
    }
  }

  return (
    <div className="card">
      <h2>Chat</h2>
      <div className="helper">Collection: <strong>{collection || '—'}</strong></div>
      
      <div className="chat-messages">
        {messages.map((msg, index) => (
          <div 
            key={index} 
            className={`message ${msg.type}-message`}
            ref={msg.type === 'bot' ? answerRef : null}
          >
            <div className="message-header">
              {msg.type === 'user' ? 'You' : 'DocuMind'}
            </div>
            <div className="message-content">
              {msg.type === 'bot' && isLoading && index === messages.length - 1 ? (
                <div className="loading-dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              ) : (
                <div dangerouslySetInnerHTML={{__html: msg.content}} />
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <textarea 
        value={q} 
        onChange={e=>setQ(e.target.value)} 
        onKeyPress={handleKeyPress}
        placeholder="Ask something about the indexed textbook..."
        disabled={isLoading}
      ></textarea>
      <div className="row">
        <button onClick={ask} disabled={!collection || isLoading || !q.trim()}>
          {isLoading ? 'Thinking...' : 'Ask'}
        </button>
      </div>

      {sources && (
        <div className="sources documind-card">
          <h4>Sources</h4>
          <div dangerouslySetInnerHTML={{__html: marked.parse(sources)}} />
        </div>
      )}
    </div>
  )
}