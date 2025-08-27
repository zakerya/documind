"use client"

import React, { useState, useEffect, useRef } from "react"
import { marked } from "marked"
import DOMPurify from "dompurify"

export default function Chat({ collection }) {
  const [q, setQ] = useState("")
  const [messages, setMessages] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [sources, setSources] = useState("")
  const messagesEndRef = useRef(null)
  const lastBotMessageRef = useRef(null)

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    const renderMathJax = async () => {
      if (typeof window !== "undefined" && window.docuMindMathJaxReady && lastBotMessageRef.current) {
        try {
          await window.docuMindMathJaxReady
          if (window.docuMindTypeset) {
            await window.docuMindTypeset(lastBotMessageRef.current)
          }
        } catch (error) {
          console.error("MathJax rendering failed:", error)
        }
      }
    }

    const lastMessage = messages[messages.length - 1]
    if (lastMessage && lastMessage.type === "bot" && !isLoading) {
      // Small delay to ensure DOM is updated
      setTimeout(renderMathJax, 100)
    }
  }, [messages, isLoading])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  const checkBackend = async () => {
    try {
      const response = await fetch("http://localhost:5000/api/health")
      return response.ok
    } catch (error) {
      console.error("Backend not available:", error)
      return false
    }
  }

  const processMathExpressions = (text) => {
    // Display math (multiline) first
    text = text.replace(/\\\[(.*?)\\\]/gs, '<div class="math-display">\\[$1\\]</div>')
    text = text.replace(/\$\$(.*?)\$\$/gs, '<div class="math-display">\\[$1\\]</div>')

    // Inline \(...\)
    text = text.replace(/\\\((.*?)\\\)/gs, '<span class="math-inline">\\($1\\)</span>')

    // Inline $...$ (avoid matching $$ and ensure content is not just whitespace)
    // This regex looks for a single $ that is not preceded or followed by another $.
    // It also ensures the content between the dollars is not empty.
    text = text.replace(/(?<!\$)\$([^\$\n]+?)\$(?!\$)/g, '<span class="math-inline">\\($1\\)</span>')

    return text
  }

  const processCodeBlocks = (text) => {
    text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
      const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      return `<pre class="code-block"><code class="language-${lang || "plaintext"}">${escaped.trim()}</code></pre>`
    })
    text = text.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
    return text
  }

  async function ask() {
    if (!collection) {
      setMessages((prev) => [...prev, { type: "user", content: q }, { type: "bot", content: "*Index a PDF first.*" }])
      setQ("")
      return
    }

    const userMessage = q
    setMessages((prev) => [...prev, { type: "user", content: userMessage }])
    setQ("")
    setIsLoading(true)

    const backendAvailable = await checkBackend()
    if (!backendAvailable) {
      setMessages((prev) => [
        ...prev,
        { type: "bot", content: "Backend server is not running. Please start the Flask backend." },
      ])
      setIsLoading(false)
      return
    }

    try {
      const payload = {
        question: userMessage,
        collection,
      }
      const resp = await fetch("http://localhost:5000/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!resp.ok) {
        throw new Error(`Server returned ${resp.status}: ${resp.statusText}`)
      }

      const data = await resp.json()

      if (data.error) {
        setMessages((prev) => [...prev, { type: "bot", content: `Backend error: ${DOMPurify.sanitize(data.error)}` }])
        return
      }

      if (data && data.answer_markdown !== undefined) {
        let md = data.answer_markdown
        const mathList = data.math_expressions || []
        mathList.forEach((m, i) => {
          const preferDisplay = m.length > 80 || m.includes("\n")
          const wrapped = preferDisplay ? `\\[${m}\\]` : `\\(${m}\\)`
          md = md.split(`<<MATH_${i}>>`).join(wrapped)
        })

        md = processMathExpressions(md)
        md = processCodeBlocks(md)

        const html = marked.parse(md)
        const clean = DOMPurify.sanitize(html)
        setMessages((prev) => [...prev, { type: "bot", content: clean }])
        setSources(data.sources_markdown || "")
        return
      }

      if (typeof data === "string") {
        let processedText = processMathExpressions(data)
        processedText = processCodeBlocks(processedText)
        const html = marked.parse(processedText)
        setMessages((prev) => [...prev, { type: "bot", content: DOMPurify.sanitize(html) }])
        return
      }

      setMessages((prev) => [...prev, { type: "bot", content: "Unexpected backend response. See console." }])
      console.log("backend response", data)
    } catch (e) {
      console.error("Request failed:", e)
      setMessages((prev) => [
        ...prev,
        {
          type: "bot",
          content: `Request failed: ${DOMPurify.sanitize(e.message)}. Make sure your backend is running on port 5000.`,
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      ask()
    }
  }

  const renderMessageContent = (content, isBotMessage, isLoadingMessage, messageIndex) => {
    if (isBotMessage && isLoadingMessage) {
      return (
        <div className="loading-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
      )
    }

    const isLastBotMessage = isBotMessage && messageIndex === messages.length - 1

    return <div ref={isLastBotMessage ? lastBotMessageRef : null} dangerouslySetInnerHTML={{ __html: content }} />
  }

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h2 className="chat-title">Chat</h2>
        <div className="model-selector">
          <button className="model-btn active">Gemini 2.5 Flash</button>
        </div>
      </div>

      <div className="helper">
        Collection: <strong>{collection || "—"}</strong>
      </div>

      <div className="chat-messages">
        {messages.map((msg, index) => (
          <div key={index} className={`message ${msg.type}-message`}>
            <div className="message-header">{msg.type === "user" ? "You" : "DocuMind"}</div>
            <div className="message-content">
              {renderMessageContent(
                msg.content,
                msg.type === "bot",
                msg.type === "bot" && isLoading && index === messages.length - 1,
                index,
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        <textarea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Ask something about the indexed textbook..."
          disabled={isLoading}
          className="chat-input"
        ></textarea>
        <button onClick={ask} disabled={!collection || isLoading || !q.trim()} className="chat-button">
          {isLoading ? "Thinking..." : "Ask"}
        </button>
      </div>

      {sources && (
        <div className="sources documind-card">
          <h4>Sources</h4>
          <div dangerouslySetInnerHTML={{ __html: marked.parse(sources) }} />
        </div>
      )}
    </div>
  )
}
