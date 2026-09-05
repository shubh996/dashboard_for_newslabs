import { Link } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Globe, Mail, ShieldCheck, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const CONTACTS = [
  {
    label: 'Email support',
    value: 'hello@9am.site',
    href: 'mailto:hello@9am.site?subject=Trigger%20support',
    icon: Mail,
  },
  {
    label: 'Privacy / data requests',
    value: 'privacy@9am.site',
    href: 'mailto:privacy@9am.site?subject=Privacy%20request',
    icon: ShieldCheck,
  },
  {
    label: 'Account deletion',
    value: 'hello@9am.site',
    href: 'mailto:hello@9am.site?subject=Account%20deletion%20request',
    icon: Trash2,
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
    question: 'How do I get help with an issue?',
    answer:
      'Email hello@9am.site. Include what you were trying to do, what went wrong, your device / OS version, and app version if you know it. Screenshots or steps to reproduce help us respond faster.',
  },
  {
    question: 'How do I delete my account?',
    answer:
      'Email hello@9am.site or privacy@9am.site with the subject “Account deletion request”. Include the email or account identifier used with Trigger. We will confirm and delete associated personal data within a reasonable period (typically within 30 days), except where retention is required by law.',
  },
  {
    question: 'What happens if I uninstall / delete the app?',
    answer:
      'Removing the app from your device deletes the app and local data on that device. Server-side account, preference, or notification records may remain until you request account deletion by email (see above).',
  },
  {
    question: 'How do I stop notifications?',
    answer:
      'Turn off notifications for Trigger in your device settings. If you also want server-side notification / device records removed, send an account or data deletion request to hello@9am.site.',
  },
  {
    question: 'How do I request a copy of my data or a privacy question?',
    answer:
      'Email privacy@9am.site. Describe whether you want access, correction, or deletion. See the Privacy Policy for more detail.',
  },
  {
    question: 'How long until support replies?',
    answer:
      'We aim to reply within a few business days. Deletion and privacy requests are handled as a priority and completed as soon as practical.',
  },
] as const

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <a
            href="https://9am.site"
            className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Website"
          >
            <ArrowLeft className="size-5" />
          </a>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight">Trigger</p>
            <p className="truncate text-xs text-muted-foreground">Support</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Support</h1>
          <p className="text-base leading-7 text-muted-foreground">
            Use this page for help with issues, account deletion, app removal / data deletion, and
            privacy requests. This is not a product overview.
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold tracking-[0.14em] text-muted-foreground">
            CONTACT
          </h2>
          <div className="grid gap-3">
            {CONTACTS.map((item) => {
              const Icon = item.icon
              return (
                <a
                  key={`${item.label}-${item.value}`}
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
          <h2 className="text-xs font-semibold tracking-[0.14em] text-muted-foreground">
            ACCOUNT & APP DELETION
          </h2>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Delete account or remove app data</CardTitle>
              <CardDescription>
                Required steps for App Store / Play Store account-deletion disclosure.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">1. Account / server data:</span> email{' '}
                <a
                  className="underline underline-offset-4"
                  href="mailto:hello@9am.site?subject=Account%20deletion%20request"
                >
                  hello@9am.site
                </a>{' '}
                with subject “Account deletion request” and the email/account used in the app.
              </p>
              <p>
                <span className="font-medium text-foreground">2. App on device:</span> uninstall
                Trigger from your phone or tablet using the normal system uninstall flow. That
                removes the app and local data on that device.
              </p>
              <p>
                <span className="font-medium text-foreground">3. Notifications:</span> disable
                Trigger notifications in system Settings if they continue after uninstall until
                server records are cleared.
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold tracking-[0.14em] text-muted-foreground">FAQ</h2>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Common questions</CardTitle>
              <CardDescription>Issues, deletion, and privacy — not product marketing.</CardDescription>
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
        </div>

        <footer className="border-t pt-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Trigger
        </footer>
      </main>
    </div>
  )
}
