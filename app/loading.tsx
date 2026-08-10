export default function Loading() {
  return (
    <main className="min-h-[100dvh] bg-slate-50 px-4 pb-32 pt-6 dark:bg-slate-950" aria-busy="true" aria-live="polite">
      <div className="mx-auto max-w-3xl animate-pulse space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-slate-200 dark:bg-slate-800" />
          <div className="space-y-2">
            <div className="h-5 w-36 rounded-full bg-slate-200 dark:bg-slate-800" />
            <div className="h-3 w-52 rounded-full bg-slate-200 dark:bg-slate-800" />
          </div>
        </div>
        <div className="h-28 rounded-[1.75rem] bg-slate-200 dark:bg-slate-800" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="h-32 rounded-[1.75rem] bg-slate-200 dark:bg-slate-800" />
          <div className="h-32 rounded-[1.75rem] bg-slate-200 dark:bg-slate-800" />
          <div className="h-32 rounded-[1.75rem] bg-slate-200 dark:bg-slate-800" />
          <div className="h-32 rounded-[1.75rem] bg-slate-200 dark:bg-slate-800" />
        </div>
      </div>
    </main>
  )
}
