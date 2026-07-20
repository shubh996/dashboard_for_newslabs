import { Link } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Globe, Mail, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const CONTACTS = [
  {
    label: 'Email support',
    value: 'hello@9am.site',
    href: 'mailto:hello@9am.site',
    icon: Mail,
  },
  {
    label: 'Privacy',
    value: 'privacy@9am.site',
    href: 'mailto:privacy@9am.site',
    icon: ShieldCheck,
  },
  {
    label: 'Website',
    value: 'https://9am.site',
    href: 'https://9am.site',
    icon: Globe,
  },
] as const

const FAQ = [
  {
    question: 'How do I save a story?',
    answer:
      'Use the bookmark / save action on a story in the feed. Saved items stay available in your saved list when that feature is enabled.',
  },
  {
    question: 'Is 9AM investment advice?',
    answer:
      'No. 9AM provides general market news and company context for information only. Nothing here is a recommendation to buy or sell any security.',
  },
  {
    question: 'How do I change theme or preferences?',
    answer:
      'Open Settings and adjust Appearance and other preference controls. Theme choice is remembered on this device.',
  },
  {
    question: 'How do I delete local data?',
    answer:
      'Clear site data in your browser settings. That removes local preferences and other data stored on this device.',
  },
  {
    question: 'How do I report a problem?',
    answer:
      'Email hello@9am.site and include your browser details (and OS version when relevant). Screenshots or steps to reproduce are helpful.',
  },
] as const

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <Link
            to="/"
            className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Back to home"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight">9AM</p>
            <p className="truncate text-xs text-muted-foreground">Support</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Support</h1>
          <p className="text-base leading-7 text-muted-foreground">
            We’re here to help with 9AM. Reach out for product questions, privacy requests, or bug
            reports.
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold tracking-[0.14em] text-muted-foreground">CONTACT</h2>
          <div className="grid gap-3">
            {CONTACTS.map((item) => {
              const Icon = item.icon
              return (
                <a
                  key={item.label}
                  href={item.href}
                  target={item.href.startsWith('http') ? '_blank' : undefined}
                  rel={item.href.startsWith('http') ? 'noreferrer' : undefined}
                  className="group block rounded-xl border bg-card transition-colors hover:bg-muted/40"
                  aria-label={`${item.label}: ${item.value}`}
                >
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                      <Icon className="size-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                      <p className="truncate text-sm font-medium">{item.value}</p>
                    </div>
                    <ExternalLink className="size-4 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" />
                  </div>
                </a>
              )
            })}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold tracking-[0.14em] text-muted-foreground">FAQ</h2>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Common questions</CardTitle>
              <CardDescription>Short answers about using 9AM.</CardDescription>
            </CardHeader>
            <CardContent className="divide-y">
              {FAQ.map((item) => (
                <div key={item.question} className="space-y-2 py-4 first:pt-0 last:pb-0">
                  <h3 className="text-sm font-semibold">{item.question}</h3>
                  <p className="text-sm leading-6 text-muted-foreground">{item.answer}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <div className="flex flex-wrap gap-3 text-sm">
          <Link to="/privacy" className="text-muted-foreground underline-offset-4 hover:underline">
            Privacy Policy
          </Link>
          <span className="text-muted-foreground/40">·</span>
          <Link to="/terms" className="text-muted-foreground underline-offset-4 hover:underline">
            Terms of Use
          </Link>
        </div>

        <footer className="border-t pt-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} 9AM
        </footer>
      </main>
    </div>
  )
}
