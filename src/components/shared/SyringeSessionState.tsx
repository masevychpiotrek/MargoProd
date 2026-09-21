import { Link } from 'react-router-dom'

export default function SyringeSessionState({ loading, error, retry }: { loading: boolean; error: Error | null; retry: () => unknown }) {
  return <div className="max-w-xl mx-auto py-12 space-y-4 text-center" role={error ? 'alert' : 'status'}>
    <p>{loading ? 'Ładowanie zmiany...' : error ? `Nie udało się odczytać zmiany: ${error.message}` : 'Brak aktywnej zmiany.'}</p>
    {error ? <button className="btn-secondary" onClick={() => retry()}>Spróbuj ponownie</button>
      : !loading && <Link className="btn-primary" to="/syringe/start">Rozpocznij zmianę</Link>}
  </div>
}
