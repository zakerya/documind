// src/components/UploadIndex.jsx
import React, { useState } from 'react'
import axios from 'axios'

/**
 * UploadIndex with IndexedDB local storage (replaces localStorage)
 * - saves indexed document to IndexedDB (documind-db / collections)
 * - uses navigator.storage.estimate() to warn if space is low
 * - falls back to skipping local save if IndexedDB fails
 */

export default function UploadIndex({ onIndexed }) {
  const [status, setStatus] = useState('No file uploaded')
  const [progress, setProgress] = useState(0)
  const [currentPage, setCurrentPage] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [isProcessing, setIsProcessing] = useState(false)

  // ---------- IndexedDB helpers ----------
  function openDB() {
    return new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open('documind-db', 1)
        req.onupgradeneeded = (e) => {
          const db = e.target.result
          if (!db.objectStoreNames.contains('collections')) {
            db.createObjectStore('collections')
          }
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      } catch (err) {
        reject(err)
      }
    })
  }

  async function idbPut(key, value) {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('collections', 'readwrite')
      const store = tx.objectStore('collections')
      const r = store.put(value, key)
      r.onsuccess = () => resolve()
      r.onerror = () => reject(r.error || tx.error)
    })
  }

  // optional helper to remove an item
  async function idbDelete(key) {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('collections', 'readwrite')
      const store = tx.objectStore('collections')
      const r = store.delete(key)
      r.onsuccess = () => resolve()
      r.onerror = () => reject(r.error || tx.error)
    })
  }
  // ---------- end IndexedDB helpers ----------

  async function trySaveLocally(collectionName, payload) {
    // Check approximate storage quota (optional)
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate()
        // estimate.quota and estimate.usage are bytes
        if (estimate.quota && estimate.usage !== undefined) {
          const free = estimate.quota - estimate.usage
          // If free space is very small, avoid trying to save large object
          // 5MB threshold chosen conservatively; you can adjust
          if (free < 5 * 1024 * 1024) {
            throw new Error('Insufficient local storage quota for this document')
          }
        }
      }
    } catch (err) {
      console.warn('Storage estimate check failed or low quota:', err)
      // continue — we'll attempt IndexedDB but surface the error if it fails
    }

    // Save into IndexedDB (structured clone — more space-friendly than localStorage)
    await idbPut(collectionName, payload)
  }

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0]
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
      setStatus('Please select a PDF file')
      return
    }

    setIsProcessing(true)
    setStatus('Loading PDF library...')
    setProgress(5)

    try {
      // robust pdfjs loader like we discussed earlier
      let pdfjsLib = window.pdfjsLib || window.PDFJS
      if (!pdfjsLib) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script')
          script.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.8.162/build/pdf.min.js'
          script.onload = () => resolve()
          script.onerror = () => reject(new Error('Failed to load pdfjs script'))
          document.head.appendChild(script)
        })
        pdfjsLib = window.pdfjsLib || window.PDFJS
      }
      if (!pdfjsLib) throw new Error('PDF.js not available (pdfjsLib / PDFJS missing)')
      if (!pdfjsLib.GlobalWorkerOptions) pdfjsLib.GlobalWorkerOptions = {}
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.8.162/build/pdf.worker.min.js'

      setStatus('Reading PDF...')
      setProgress(10)

      const arrayBuffer = await file.arrayBuffer()
      setProgress(20)

      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
      const pdf = await loadingTask.promise

      setTotalPages(pdf.numPages)
      setStatus(`Extracting ${pdf.numPages} pages...`)

      let pages = []
      for (let i = 1; i <= pdf.numPages; i++) {
        setCurrentPage(i)
        const page = await pdf.getPage(i)
        const textContent = await page.getTextContent()
        const pageText = textContent.items.map(it => it.str).join(' ')
        pages.push({ page: i, text: pageText })

        const pageProgress = Math.floor((i / pdf.numPages) * 60) + 20
        setProgress(pageProgress)
        await new Promise(resolve => setTimeout(resolve, 50))
      }

      setStatus('Chunking text...')
      setProgress(85)

      // chunking logic (same as before)
      const chunkSize = 1500
      const overlap = 300
      const chunks = []
      pages.forEach(p => {
        const txt = (p.text || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
        let s = 0
        while (s < txt.length) {
          const e = Math.min(s + chunkSize, txt.length)
          const chunk = txt.slice(s, e).trim()
          if (chunk.length > 50) chunks.push({ page: p.page, text: chunk })
          if (e === txt.length) break
          s = e - overlap
        }
      })

      setProgress(95)

      // prepare collection name and payload
      const collectionName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_') + '_' + Date.now()
      const payload = {
        source: file.name,
        chunks,
        totalPages: pdf.numPages,
        processedAt: new Date().toISOString()
      }

      // Try to save locally to IndexedDB
      try {
        setStatus('Saving index locally (IndexedDB)...')
        await trySaveLocally('documind:' + collectionName, payload)
        setStatus(`Indexed ${chunks.length} chunks from ${pdf.numPages} pages (saved locally).`)
      } catch (saveErr) {
        // If saving locally fails (quota or other) — don't crash: continue and send to backend
        console.warn('Local save failed, skipping local save:', saveErr)
        setStatus(`Indexed ${chunks.length} chunks from ${pdf.numPages} pages (local save skipped).`)
      }

      setProgress(100)
      onIndexed(collectionName)

      // Send to backend (best-effort)
      try {
        await axios.post('http://localhost:5000/api/index', {
          collection: collectionName,
          chunks,
          source: file.name
        })
      } catch (err) {
        console.error('Failed to send to backend:', err)
      }
    } catch (error) {
      console.error('Error processing PDF:', error)
      setStatus(`Error: ${error.message}. Please try another file.`)
      setProgress(0)
    } finally {
      setIsProcessing(false)
      setTimeout(() => {
        setCurrentPage(0)
        setTotalPages(0)
      }, 2000)
    }
  }

  return (
    <div className="card">
      <h2>Upload & Index</h2>
      <input
        type="file"
        accept="application/pdf"
        onChange={handleFile}
        disabled={isProcessing}
      />

      <div className="progress-container" style={{marginTop: '15px'}}>
        <div className="progress-info">
          <span className="status">{status}</span>
          {totalPages > 0 && (
            <span className="page-info">
              Page {currentPage} of {totalPages}
            </span>
          )}
        </div>

        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{width: `${progress}%`}}
          ></div>
        </div>

        <div className="progress-text">{progress}%</div>
      </div>

      {isProcessing && (
        <div className="processing-indicator">
          <div className="spinner"></div>
          <span>Processing... This may take a while for large PDFs</span>
        </div>
      )}
    </div>
  )
}