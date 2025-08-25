// src/hooks/useMathJax.js
import { useEffect } from 'react'

/**
 * useMathJax
 * - Loads MathJax v3 from CDN (tex-mml-chtml build)
 * - Sets a config that:
 *   - disables automatic startup typeset (we call typesetPromise manually)
 *   - recognizes \( \), \[ \] and $ $ as math delimiters (you can customize)
 * - Exposes:
 *   - window.docuMindMathJaxReady: Promise that resolves when MathJax is ready
 *   - window.docuMindTypeset(el): async fn to typeset a specific DOM node
 */
export default function useMathJax () {
  useEffect(() => {
    if (typeof window === 'undefined') return

    // If already loaded, just ensure helper exists
    if (window.MathJax && window.docuMindTypeset) return

    // Provide configuration BEFORE the script loads
    // - startup.typeset = false to prevent automatic typeset of the whole page
    // - define inline/display delimiters (add or remove as you prefer)
    window.MathJax = {
      startup: {
        typeset: false // we'll call typesetPromise manually on specific nodes
      },
      tex: {
        inlineMath: [['\\(', '\\)'], ['$', '$']],      // allow \(..\) and $..$
        displayMath: [['\\[', '\\]'], ['$$', '$$']],  // allow \[..\] and $$..$$
        packages: ['base', 'ams'] // load common TeX packages; add 'mhchem' if you need
      },
      options: {
        // keep MathJax from trying to typeset inside these tags
        skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre']
      }
    }

    // Create a promise that resolves when MathJax is fully loaded and startup ready
    let readyResolve, readyReject
    window.docuMindMathJaxReady = new Promise((resolve, reject) => {
      readyResolve = resolve
      readyReject = reject
    })

    // Load the MathJax script from CDN
    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js'
    script.async = true

    script.onload = async () => {
      try {
        // Wait for MathJax startup to finish
        // MathJax exposes startup.promise per v3; wait for it.
        if (window.MathJax && window.MathJax.startup && window.MathJax.startup.promise) {
          await window.MathJax.startup.promise
        }
        // Expose helper to typeset a single element (safe)
        window.docuMindTypeset = async (el) => {
          try {
            if (!window.MathJax) return
            // Accept selector strings too
            const nodes = []
            if (!el) {
              // if no element passed, fallback to typeset the whole document body
              nodes.push(document.body)
            } else if (typeof el === 'string') {
              const node = document.querySelector(el)
              if (node) nodes.push(node)
            } else if (el instanceof Element) {
              nodes.push(el)
            } else if (Array.isArray(el)) {
              el.forEach(x => x instanceof Element && nodes.push(x))
            }
            if (nodes.length === 0) return
            await window.MathJax.typesetPromise(nodes)
          } catch (e) {
            console.error('MathJax typeset failed', e)
            throw e
          }
        }

        readyResolve(true)
      } catch (e) {
        console.error('MathJax initialization failed', e)
        readyReject(e)
      }
    }

    script.onerror = (err) => {
      console.error('Failed to load MathJax script', err)
      if (readyReject) readyReject(err)
    }

    document.head.appendChild(script)

    // Cleanup: we don't remove the script because other parts of the app may need MathJax.
    return () => {
      // No explicit removal — MathJax v3 isn't designed to be hot-unloaded.
    }
  }, [])
}