export default function OperatorTasks() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Zadania</h1>
        <p className="mt-1 text-navy-400">Modul zadan operatora jest w budowie.</p>
      </div>

      <div className="card border-2 border-brand/30">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10 text-4xl">
            🥚
          </div>
          <div className="min-w-0">
            <div className="text-xl font-bold text-brand">Plan sie kluje</div>
            <p className="mt-2 text-sm leading-relaxed text-navy-300">
              Tutaj pojawia sie zadania dla operatora: kontrola, przezbrojenie, sprzatanie, probki jakosciowe
              i potwierdzenia wykonania. Na razie to spokojny placeholder, bez udawania gotowej funkcji.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
