import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

export type LegalSection = {
  heading: string
  body: string[]
}

type Props = {
  title: string
  lastUpdated: string
  intro?: string
  sections: LegalSection[]
}

export function LegalDocumentPage({ title, lastUpdated, intro, sections }: Props) {
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
            <p className="truncate text-xs text-muted-foreground">{title}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated {lastUpdated}</p>

        {intro ? (
          <p className="mt-6 text-base leading-7 text-muted-foreground">{intro}</p>
        ) : null}

        <div className="mt-8 space-y-8">
          {sections.map((section) => (
            <section key={section.heading} className="space-y-3">
              <h2 className="text-lg font-semibold tracking-tight">{section.heading}</h2>
              {section.body.map((paragraph) => (
                <p
                  key={paragraph.slice(0, 64)}
                  className={cn(
                    'text-base leading-7 text-muted-foreground',
                    paragraph.startsWith('•') && 'pl-1',
                  )}
                >
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>

        <footer className="mt-12 border-t pt-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} 9AM
        </footer>
      </main>
    </div>
  )
}
