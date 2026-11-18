import { useEffect, useState } from 'react';
import { getAvisos } from './api/avisos.js';

function formatDate(value) {
  if (!value) return '';

  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function getErrorMessage(error) {
  if (error?.status === 401) {
    return 'Tu sesión ha caducado. Inicia sesión de nuevo.';
  }

  if (error?.status === 404) {
    return 'La página solicitada no existe.';
  }

  if (error?.status === 503) {
    return 'La consulta de avisos no está disponible en este momento.';
  }

  return error?.message || 'No se han podido consultar los avisos.';
}

// SCRUM-57 / US-014: pantalla del feed de avisos de pérdida.
export function FeedAvisosPage() {
  const [pagina, setPagina] = useState(1);

  const [results, setResults] = useState({
    avisos: [],
    paginacion: null,
    message: '',
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadAvisos() {
      setLoading(true);
      setError('');

      try {
        const data = await getAvisos(pagina, 12);

        if (!cancelled) {
          setResults({
            avisos: data?.avisos ?? [],
            paginacion: data?.paginacion ?? null,
            message: data?.message ?? '',
          });
        }
      } catch (err) {
        if (!cancelled) {
          setResults({
            avisos: [],
            paginacion: null,
            message: '',
          });

          setError(getErrorMessage(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    // loadAvisos captura sus propios errores; se marca como ignorada la promesa (SonarCloud S9383).
    void loadAvisos();

    return () => {
      cancelled = true;
    };
  }, [pagina]);

  return (
    <main className="home">
      <header className="home-header">
        <a className="brand" href="#app">
          Lost&Found UEx
        </a>

        <nav aria-label="Navegación">
          <a href="#app">Volver a portada</a>
        </nav>
      </header>

      <section className="hero" aria-labelledby="feed-title">
        <span className="eyebrow">
          AVISOS DE PÉRDIDA · CAMPUS UEx
        </span>

        <h1 id="feed-title">Feed de avisos de pérdida</h1>

        <p>
          Consulta los avisos de pérdida activos publicados
          por otros usuarios de la comunidad universitaria.
        </p>
      </section>

      <section
        className="home-grid"
        aria-label="Avisos de pérdida"
        aria-live="polite"
        aria-busy={loading}
      >
        {loading && (
          <p role="status">Cargando avisos...</p>
        )}

        {!loading && error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {!loading && !error && results.avisos.length === 0 && (
          <article className="card">
            <h2>No hay avisos</h2>

            <p>
              {results.message ||
                'Todavía no hay avisos de pérdida activos.'}
            </p>
          </article>
        )}

        {!loading && !error && results.avisos.map(aviso => (
          <article className="card" key={aviso.id}>
            <h2>{aviso.descripcion}</h2>

            <p>
              <strong>Categoría:</strong>{' '}
              {aviso.categoria?.nombre}
            </p>

            <p>
              <strong>Facultad:</strong>{' '}
              {aviso.facultad?.nombre}
            </p>

            {aviso.centro && (
              <p>
                <strong>Centro:</strong>{' '}
                {aviso.centro.nombre}
              </p>
            )}

            <p>
              <strong>Fecha aproximada:</strong>{' '}
              {formatDate(aviso.fechaPerdida)}
            </p>

            <p>
              <strong>Estado:</strong>{' '}
              {aviso.estado}
            </p>
          </article>
        ))}
      </section>

      {!loading && error && pagina > 1 && (
        <div className="hero-actions">
          <button type="button" onClick={() => setPagina(1)}>
            Volver a la primera página
          </button>
        </div>
      )}

      {!loading &&
        !error &&
        results.paginacion &&
        results.paginacion.totalPaginas > 0 && (
          <nav
            className="hero-actions"
            aria-label="Paginación de avisos"
          >
            <button
              type="button"
              disabled={!results.paginacion.anterior}
              onClick={() => setPagina(current => current - 1)}
            >
              Página anterior
            </button>

            <span>
              Página {results.paginacion.pagina} de{' '}
              {results.paginacion.totalPaginas}
            </span>

            <button
              type="button"
              disabled={!results.paginacion.siguiente}
              onClick={() => setPagina(current => current + 1)}
            >
              Página siguiente
            </button>
          </nav>
        )}
    </main>
  );
}