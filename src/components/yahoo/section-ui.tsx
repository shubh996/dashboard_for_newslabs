import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <Card className="w-full">
      <CardHeader className="flex items-start justify-between gap-3">
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function SectionEmpty({ message }: { message: string }) {
  return <p className="py-4 text-sm text-muted-foreground">{message}</p>
}

/** Format any finite number to exactly 1 decimal place (e.g. 315.3). */
export function formatDecimal(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A'
  return value.toFixed(1)
}
