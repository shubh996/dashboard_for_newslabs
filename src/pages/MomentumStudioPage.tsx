import { MomentumStudioApp } from '@/components/momentum-studio/MomentumStudioApp'

/**
 * Official shadcn New York dashboard-01 shell.
 * Original Momentum desk at /notifications is untouched.
 */
export default function MomentumStudioPage() {
  return (
    <div
      data-momentum-studio
      className="group/body h-svh overflow-hidden overscroll-none bg-background text-foreground antialiased"
    >
      <MomentumStudioApp />
    </div>
  )
}

