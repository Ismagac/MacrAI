'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Grabación de voz para MacrAI.
//
// Dos modos distintos, deliberadamente separados:
//  - dictado: grabas, se transcribe y el texto queda en el input para revisarlo.
//  - conversación: escucha continua, corta sola al detectar silencio y envía.
//
// La detección de silencio se hace midiendo el volumen con un AnalyserNode:
// una vez que el usuario ha empezado a hablar, un tramo suficientemente largo
// por debajo del umbral cierra el turno.

const SILENCE_THRESHOLD = 0.014
const SILENCE_MS = 1400
const MAX_TURN_MS = 30000
const MIN_BLOB_BYTES = 1200

export type RecordingMode = 'idle' | 'dictation' | 'conversation'

async function transcribe(blob: Blob): Promise<string> {
  const form = new FormData()
  form.append('audio', blob, 'audio.webm')
  const res = await fetch('/api/transcribe', { method: 'POST', body: form })
  if (!res.ok) throw new Error('transcription failed')
  const data = (await res.json()) as { text?: string }
  return (data.text ?? '').trim()
}

export function useSpeech({
  onDictation,
  onConversationTurn,
}: {
  onDictation: (text: string) => void
  onConversationTurn: (text: string) => Promise<void>
}) {
  const [mode, setMode] = useState<RecordingMode>('idle')
  const [level, setLevel] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const modeRef = useRef<RecordingMode>('idle')
  const cancelledRef = useRef(false)

  // El callback de conversación cambia en cada render; se guarda en ref para
  // que el bucle de audio siempre use la versión actual.
  const turnRef = useRef(onConversationTurn)
  useEffect(() => {
    turnRef.current = onConversationTurn
  }, [onConversationTurn])

  const teardown = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recorderRef.current = null
    setLevel(0)
  }, [])

  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    setSpeaking(false)
  }, [])

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'es-ES'
    utterance.rate = 1.05
    setSpeaking(true)
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    window.speechSynthesis.speak(utterance)
  }, [])

  const stop = useCallback(() => {
    modeRef.current = 'idle'
    setMode('idle')
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    else teardown()
  }, [teardown])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    stop()
    stopSpeaking()
  }, [stop, stopSpeaking])

  const start = useCallback(
    async (target: Exclude<RecordingMode, 'idle'>) => {
      setError(null)
      cancelledRef.current = false
      stopSpeaking()

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch {
        setError('No tengo acceso al micrófono. Revisa los permisos del navegador.')
        return
      }

      streamRef.current = stream
      modeRef.current = target
      setMode(target)

      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        const wasMode = modeRef.current
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        teardown()

        if (cancelledRef.current || blob.size < MIN_BLOB_BYTES) return

        try {
          const text = await transcribe(blob)
          if (!text || cancelledRef.current) return

          if (target === 'dictation') {
            // Dictado: el texto va al input. NUNCA se envía solo — el usuario revisa.
            onDictation(text)
          } else {
            await turnRef.current(text)
            // Sigue escuchando mientras el modo conversación siga activo.
            if (!cancelledRef.current && wasMode === 'conversation') {
              void start('conversation')
            }
          }
        } catch {
          setError('No pude transcribir el audio. Inténtalo de nuevo.')
        }
      }

      recorder.start()

      // Sólo el modo conversación corta solo; el dictado lo para el usuario.
      if (target !== 'conversation') return

      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser)

      const buffer = new Float32Array(analyser.fftSize)
      const startedAt = Date.now()
      let hasSpoken = false
      let silenceStart: number | null = null

      const tick = () => {
        analyser.getFloatTimeDomainData(buffer)
        let sum = 0
        for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i]
        const rms = Math.sqrt(sum / buffer.length)
        setLevel(rms)

        const now = Date.now()
        if (rms > SILENCE_THRESHOLD) {
          hasSpoken = true
          silenceStart = null
        } else if (hasSpoken) {
          silenceStart ??= now
          if (now - silenceStart > SILENCE_MS) {
            if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
            return
          }
        }

        if (now - startedAt > MAX_TURN_MS) {
          if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
          return
        }

        rafRef.current = requestAnimationFrame(tick)
      }

      rafRef.current = requestAnimationFrame(tick)
    },
    [onDictation, stopSpeaking, teardown]
  )

  useEffect(() => {
    return () => {
      cancelledRef.current = true
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      teardown()
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
    }
  }, [teardown])

  return { mode, level, speaking, error, start, stop, cancel, speak, stopSpeaking, setError }
}
