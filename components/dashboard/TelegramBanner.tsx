'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { Send, Unlink, ExternalLink, RefreshCw, CheckCircle2 } from 'lucide-react'
import Image from 'next/image'

interface LinkStatus {
  linked: boolean
  chatId: number | null
}

interface LinkData {
  code: string
  deepLink: string
  expiresAt: string
}

export function TelegramBanner() {
  const t = useTranslations('telegram')
  const { toast } = useToast()

  const [status, setStatus] = useState<LinkStatus | null>(null)
  const [linkData, setLinkData] = useState<LinkData | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [polling, setPolling] = useState(false)

  const fetchStatus = useCallback(async () => {
    const res = await fetch('/api/telegram/link')
    if (res.ok) setStatus(await res.json())
  }, [])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // Poll for link confirmation after generating code
  useEffect(() => {
    if (!polling) return
    const interval = setInterval(async () => {
      const res = await fetch('/api/telegram/link')
      if (res.ok) {
        const data: LinkStatus = await res.json()
        if (data.linked) {
          setStatus(data)
          setLinkData(null)
          setQrDataUrl(null)
          setPolling(false)
          toast({ title: t('linkSuccess') })
        }
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [polling, t, toast])

  async function handleConnect() {
    setLoading(true)
    try {
      const res = await fetch('/api/telegram/link', { method: 'POST' })
      if (!res.ok) throw new Error()
      const data: LinkData = await res.json()
      setLinkData(data)

      // Generate QR code on client side
      const QRCode = (await import('qrcode')).default
      const url = await QRCode.toDataURL(data.deepLink, { width: 180, margin: 1 })
      setQrDataUrl(url)
      setPolling(true)
    } catch {
      toast({ title: t('linkError'), variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  async function handleUnlink() {
    if (!confirm(t('unlinkConfirm'))) return
    setLoading(true)
    try {
      await fetch('/api/telegram/unlink', { method: 'POST' })
      setStatus({ linked: false, chatId: null })
      setLinkData(null)
      setQrDataUrl(null)
    } finally {
      setLoading(false)
    }
  }

  // Loading state
  if (status === null) return null

  // Already linked
  if (status.linked) {
    return (
      <Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
              <div>
                <p className="font-semibold text-green-800 dark:text-green-300 text-sm">
                  {t('linked')}
                </p>
                <p className="text-xs text-green-700 dark:text-green-400">
                  Gestiona tu dieta directamente en Telegram
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="text-xs border-green-300 dark:border-green-700"
                asChild
              >
                <a
                  href={`https://t.me/${process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? 'MacrAI_bot'}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Send className="h-3 w-3 mr-1" />
                  Abrir bot
                  <ExternalLink className="h-3 w-3 ml-1" />
                </a>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-destructive hover:text-destructive"
                onClick={handleUnlink}
                disabled={loading}
              >
                <Unlink className="h-3 w-3 mr-1" />
                {t('unlink')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Show link flow
  if (linkData && qrDataUrl) {
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="pt-5 pb-5">
          <div className="flex flex-col sm:flex-row items-center gap-5">
            <Image
              src={qrDataUrl}
              alt="QR Telegram"
              width={160}
              height={160}
              className="rounded-lg border border-border"
              unoptimized
            />
            <div className="flex-1 space-y-3 text-center sm:text-left">
              <div>
                <p className="font-semibold text-sm">Escanea el QR o usa el enlace</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('awaitingVerification')}
                </p>
              </div>
              <div className="bg-background rounded-lg border px-4 py-2 inline-block">
                <p className="text-xs text-muted-foreground">{t('verificationCode')}</p>
                <p className="text-2xl font-mono font-bold tracking-widest text-brand">
                  {linkData.code}
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button size="sm" asChild>
                  <a href={linkData.deepLink} target="_blank" rel="noopener noreferrer">
                    <Send className="h-4 w-4 mr-2" />
                    Abrir en Telegram
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleConnect}
                  disabled={loading}
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Nuevo código
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Expira:{' '}
                {new Date(linkData.expiresAt).toLocaleTimeString('es-ES', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Default: offer to connect
  return (
    <Card className="border-primary/40">
      <CardContent className="pt-4 pb-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex items-start gap-3 flex-1">
            <Send className="h-5 w-5 text-brand mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-sm">{t('bannerTitle')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t('bannerDesc')}</p>
            </div>
          </div>
          <Button size="sm" onClick={handleConnect} disabled={loading} className="shrink-0">
            {loading ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            {t('connectBtn')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
