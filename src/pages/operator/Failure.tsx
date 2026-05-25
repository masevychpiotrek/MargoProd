export default function OperatorFailure() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Zglos awarie</h1>
        <p className="mt-1 text-navy-400">Modul utrzymania ruchu jest w budowie.</p>
      </div>

      <div className="card border-2 border-amber-500/30">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-4xl">
            🥚
          </div>
          <div className="min-w-0">
            <div className="text-xl font-bold text-amber-300">Jeszcze sie wykluwa</div>
            <p className="mt-2 text-sm leading-relaxed text-navy-300">
              Tu bedzie szybkie zglaszanie awarii: maszyna, typ problemu, opis, zdjecie i status reakcji.
              Na razie modul jest oznaczony jako planowany, zeby operatorzy wiedzieli, ze to miejsce juz czeka.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
