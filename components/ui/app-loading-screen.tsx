export function AppLoadingScreen({ label = 'Đang mở Trí Candy…' }: { label?: string }) {
  return (
    <main className="grid min-h-[100dvh] place-items-center overflow-hidden bg-[radial-gradient(circle_at_18%_12%,rgba(217,70,239,.16),transparent_34%),radial-gradient(circle_at_88%_86%,rgba(79,70,229,.14),transparent_38%),#f8fafc] px-6 text-slate-950 dark:bg-[radial-gradient(circle_at_18%_12%,rgba(217,70,239,.16),transparent_34%),radial-gradient(circle_at_88%_86%,rgba(79,70,229,.18),transparent_38%),#020617] dark:text-white" aria-busy="true" aria-live="polite">
      <section className="text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-[1.4rem] bg-gradient-to-br from-fuchsia-500 via-violet-600 to-indigo-600 text-2xl font-black text-white shadow-xl shadow-indigo-900/20">T</div>
        <p className="mt-5 text-lg font-black tracking-tight">Trí Candy</p>
        <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-300">{label}</p>
        <div className="mx-auto mt-5 flex items-center justify-center gap-1.5" aria-hidden="true">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-fuchsia-500 [animation-delay:-.25s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-600 [animation-delay:-.1s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-600" />
        </div>
      </section>
    </main>
  )
}
