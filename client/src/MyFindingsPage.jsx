import { useCallback, useEffect, useRef, useState } from 'react';
import { getHallazgoOptions } from './api/hallazgos.js';
import {
  changeMyHallazgoState, getMyHallazgo, getMyHallazgoHistory, listMyHallazgos, myHallazgoImageUrl, updateMyHallazgo,
} from './api/misHallazgos.js';

const TEXT_MAX = 2000;
const STATE_ACTIONS = {
  Devuelto: { button: 'Marcar como devuelto', confirm: 'Confirmar devolución', done: 'Hallazgo marcado como devuelto.',
    help: 'Úsalo cuando el objeto ya se haya entregado a su propietario.' },
  Retirado: { button: 'Retirar', confirm: 'Confirmar retirada', done: 'Hallazgo retirado.',
    help: 'Dejará de aparecer en la búsqueda pública.' },
};
const EDITABLE = ['facultadId', 'categoriaId', 'descripcion', 'fechaHallazgo', 'latitud', 'longitud', 'puntoEntrega', 'rasgosPrivados'];

function today() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** 2026-01-15 → 15/01/2026 sin pasar por Date, para no desplazar el día por la zona horaria. */
const formatDate = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? value.split('-').reverse().join('/') : value ?? '');
const formatDateTime = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '';
};

const toForm = (hallazgo) => Object.fromEntries(EDITABLE.map(field => [field, hallazgo[field] == null ? '' : String(hallazgo[field])]));

function validate(form) {
  const errors = {};
  if (!form.facultadId) errors.facultadId = 'Selecciona una facultad.';
  if (!form.categoriaId) errors.categoriaId = 'Selecciona una categoría.';
  if (!form.descripcion.trim()) errors.descripcion = 'Describe el objeto encontrado.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.fechaHallazgo)) errors.fechaHallazgo = 'Indica la fecha del hallazgo.';
  else if (form.fechaHallazgo > today()) errors.fechaHallazgo = 'La fecha no puede ser futura.';
  for (const [field, limit] of [['latitud', 90], ['longitud', 180]]) {
    const number = Number(form[field]);
    if (form[field].trim() === '' || !Number.isFinite(number) || Math.abs(number) > limit) {
      errors[field] = `Introduce una ${field} entre -${limit} y ${limit}.`;
    }
  }
  return errors;
}

/** Solo los campos modificados, con los tipos que espera la API. */
function changes(original, form) {
  const result = {};
  for (const field of EDITABLE) {
    if (form[field] === original[field]) continue;
    if (field === 'latitud' || field === 'longitud') {
      if (Number(form[field]) !== Number(original[field])) result[field] = Number(form[field]);
    } else {
      result[field] = field === 'descripcion' ? form[field].trim() : form[field];
    }
  }
  return result;
}

/** SCRUM-113 / US-010 · Mis hallazgos: consultar, editar, marcar como devuelto o retirar. */
export function MyFindingsPage() {
  const [list, setList] = useState({ status: 'loading', items: [] });
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState({ status: 'idle' });
  const [mode, setMode] = useState('view');
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState({ text: '', ok: false });
  const [saving, setSaving] = useState(false);
  const feedback = useRef(null);

  const loadList = useCallback(() => listMyHallazgos()
    .then(data => setList({ status: 'ready', items: data.hallazgos ?? [] }))
    .catch(error => setList({ status: error.status === 401 ? 'unauthenticated' : 'error', items: [], error: error.message })), []);

  const loadDetail = useCallback((id) => {
    setDetail(current => ({ ...current, status: 'loading' }));
    return Promise.all([getMyHallazgo(id), getMyHallazgoHistory(id)])
      .then(([data, history]) => setDetail({ status: 'ready', hallazgo: data.hallazgo, historial: history.historial ?? [] }))
      .catch(error => setDetail({ status: 'error', error: error.message }));
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { if (message.text) feedback.current?.focus(); }, [message]);

  function open(item) {
    setSelected(item);
    setMode('view');
    setMessage({ text: '', ok: false });
    setErrors({});
    loadDetail(item.id);
  }

  function back() {
    setSelected(null);
    setDetail({ status: 'idle' });
    setMode('view');
    setMessage({ text: '', ok: false });
  }

  async function startEdit() {
    setMessage({ text: '', ok: false });
    setErrors({});
    try {
      const data = options ?? await getHallazgoOptions();
      setOptions(data);
      setForm(toForm(detail.hallazgo));
      setMode('edit');
    } catch (error) {
      setMessage({ text: error.message, ok: false });
    }
  }

  function startState(estado) {
    setMotivo('');
    setErrors({});
    setMessage({ text: '', ok: false });
    setMode(estado);
  }

  async function run(action, success) {
    setSaving(true);
    setErrors({});
    setMessage({ text: '', ok: false });
    try {
      await action();
      await Promise.all([loadDetail(selected.id), loadList()]);
      setMode('view');
      setMessage({ text: success, ok: true });
    } catch (error) {
      setErrors(error.errors || {});
      setMessage({ text: error.message, ok: false });
      // Si otra pestaña ya cambió el estado, mostrar la situación real.
      if (error.status === 409) { await loadDetail(selected.id); setMode('view'); }
    } finally {
      setSaving(false);
    }
  }

  function saveEdit(event) {
    event.preventDefault();
    const validationErrors = validate(form);
    if (Object.keys(validationErrors).length) {
      setErrors(validationErrors);
      setMessage({ text: 'Revisa los datos introducidos.', ok: false });
      return;
    }
    const cambios = changes(toForm(detail.hallazgo), form);
    if (!Object.keys(cambios).length) {
      setMessage({ text: 'No has cambiado ningún dato.', ok: false });
      return;
    }
    // run captura sus propios errores; se marca como ignorada la promesa (SonarCloud S9383).
    void run(() => updateMyHallazgo(selected.id, cambios), 'Hallazgo actualizado correctamente.');
  }

  function saveState(event) {
    event.preventDefault();
    if ([...motivo].length > TEXT_MAX) {
      setErrors({ motivo: `No puede superar los ${TEXT_MAX} caracteres.` });
      return;
    }
    // run captura sus propios errores; se marca como ignorada la promesa (SonarCloud S9383).
    void run(() => changeMyHallazgoState(selected.id, mode, motivo.trim()), STATE_ACTIONS[mode].done);
  }

  const feedbackLine = <p ref={feedback} role="status" aria-live="polite" tabIndex="-1" className={message.ok ? 'success' : 'error'}>{message.text}</p>;
  const fieldError = name => errors[name] && <p id={`mio-${name}-error`} className="error">{errors[name]}</p>;
  const field = name => ({
    id: `mio-${name}`, name, value: form[name], disabled: saving, 'aria-invalid': Boolean(errors[name]),
    'aria-describedby': errors[name] ? `mio-${name}-error` : undefined,
    onChange: event => setForm(current => ({ ...current, [name]: event.target.value })),
  });

  function renderList() {
    if (list.status === 'loading') return <p role="status">Cargando tus hallazgos…</p>;
    if (list.status === 'unauthenticated') return <p className="error">Debes iniciar sesión para ver tus hallazgos. <a href="#inicio-sesion">Iniciar sesión</a></p>;
    if (list.status === 'error') return <p className="error" role="alert">{list.error}</p>;
    if (!list.items.length) return <p>Todavía no has publicado ningún hallazgo. <a href="#publicar-hallazgo">Publicar un hallazgo</a></p>;
    return <ul className="my-findings" aria-label="Tus hallazgos">
      {list.items.map(item => <li key={item.id} className="my-finding">
        {item.imagen ? <img src={item.imagen} alt="" loading="lazy" /> : <span className="my-finding-noimage" aria-hidden="true" />}
        <div>
          <p className="my-finding-title"><strong>{item.descripcion}</strong></p>
          <p className="help">{item.categoria} · {item.facultad} · {formatDate(item.fechaHallazgo)}</p>
          <p><span className={`estado estado-${item.estado.toLowerCase()}`}>{item.estado}</span></p>
        </div>
        <button type="button" className="secondary" onClick={() => open(item)} aria-label={`Ver y gestionar: ${item.descripcion}`}>Ver y gestionar</button>
      </li>)}
    </ul>;
  }

  function renderEdit() {
    return <form onSubmit={saveEdit} aria-busy={saving} noValidate aria-labelledby="edit-title">
      <h2 id="edit-title">Editar hallazgo</h2>
      <label htmlFor="mio-facultadId">Facultad donde se entregará</label>
      <select {...field('facultadId')}>
        <option value="">Selecciona una facultad</option>
        {options.facultades.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}
      </select>
      {fieldError('facultadId')}
      <label htmlFor="mio-categoriaId">Categoría</label>
      <select {...field('categoriaId')}>
        <option value="">Selecciona una categoría</option>
        {options.categorias.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}
      </select>
      {fieldError('categoriaId')}
      <label htmlFor="mio-descripcion">Descripción pública</label>
      <textarea {...field('descripcion')} rows={4} maxLength={TEXT_MAX} />
      {fieldError('descripcion')}
      <label htmlFor="mio-fechaHallazgo">Fecha del hallazgo</label>
      <input {...field('fechaHallazgo')} type="date" max={today()} />
      {fieldError('fechaHallazgo')}
      <div className="coordinate-fields">
        <div>
          <label htmlFor="mio-latitud">Latitud</label>
          <input {...field('latitud')} type="number" inputMode="decimal" step="any" min={-90} max={90} />
          {fieldError('latitud')}
        </div>
        <div>
          <label htmlFor="mio-longitud">Longitud</label>
          <input {...field('longitud')} type="number" inputMode="decimal" step="any" min={-180} max={180} />
          {fieldError('longitud')}
        </div>
      </div>
      <label htmlFor="mio-puntoEntrega">Punto de entrega (opcional)</label>
      <input {...field('puntoEntrega')} type="text" maxLength={TEXT_MAX} />
      {fieldError('puntoEntrega')}
      <label htmlFor="mio-rasgosPrivados">Rasgos identificativos privados (opcional)</label>
      <textarea {...field('rasgosPrivados')} rows={3} maxLength={TEXT_MAX} />
      <p className="help">Solo los ves tú. No se muestran en la búsqueda pública.</p>
      {fieldError('rasgosPrivados')}
      <p className="help">Las fotos no se pueden cambiar desde aquí.</p>
      <div className="actions">
        <button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
        <button type="button" className="secondary" disabled={saving} onClick={() => { setMode('view'); setErrors({}); setMessage({ text: '', ok: false }); }}>Cancelar</button>
      </div>
    </form>;
  }

  function renderState() {
    const action = STATE_ACTIONS[mode];
    return <form onSubmit={saveState} aria-busy={saving} noValidate aria-labelledby="state-title">
      <h2 id="state-title">{action.button}</h2>
      <p className="help">{action.help} Esta acción no se puede deshacer: el hallazgo no podrá volver a estar activo.</p>
      <label htmlFor="mio-motivo">Motivo (opcional)</label>
      <textarea id="mio-motivo" name="motivo" rows={3} maxLength={TEXT_MAX} value={motivo} disabled={saving}
        aria-invalid={Boolean(errors.motivo)} aria-describedby={errors.motivo ? 'mio-motivo-error' : undefined}
        onChange={event => setMotivo(event.target.value)} />
      {fieldError('motivo')}
      <div className="actions">
        <button type="submit" disabled={saving}>{saving ? 'Guardando…' : action.confirm}</button>
        <button type="button" className="secondary" disabled={saving} onClick={() => { setMode('view'); setErrors({}); }}>Cancelar</button>
      </div>
    </form>;
  }

  function renderDetail() {
    if (detail.status === 'loading' && !detail.hallazgo) return <p role="status">Cargando el hallazgo…</p>;
    if (detail.status === 'error') return <p className="error" role="alert">{detail.error}</p>;
    if (!detail.hallazgo) return null;
    const h = detail.hallazgo;
    const activo = h.estado === 'Activo';
    // Nombres de la lista recargada: tras editar la categoría o la facultad se ven los nuevos.
    const item = list.items.find(entry => entry.id === h.id) ?? selected;
    return <article aria-labelledby="detail-title">
      <h2 id="detail-title">{h.descripcion}</h2>
      <p><span className={`estado estado-${h.estado.toLowerCase()}`}>{h.estado}</span></p>
      <dl className="finding-data">
        <dt>Categoría</dt><dd>{item.categoria}</dd>
        <dt>Facultad de entrega</dt><dd>{item.facultad}</dd>
        <dt>Fecha del hallazgo</dt><dd>{formatDate(h.fechaHallazgo)}</dd>
        <dt>Ubicación</dt><dd>{h.latitud}, {h.longitud}</dd>
        <dt>Punto de entrega</dt><dd>{h.puntoEntrega || 'Sin indicar'}</dd>
        <dt>Rasgos privados <span className="help">(solo los ves tú)</span></dt><dd>{h.rasgosPrivados || 'Sin indicar'}</dd>
      </dl>
      {h.imagenes?.length > 0 && <ul className="finding-photos" aria-label="Fotos del hallazgo">
        {h.imagenes.map(imagen => <li key={imagen.id}><img src={myHallazgoImageUrl(h.id, imagen.id)} alt={`Foto ${imagen.posicion} del hallazgo`} /></li>)}
      </ul>}

      {mode === 'view' && (activo
        ? <div className="actions">
          <button type="button" onClick={startEdit}>Editar</button>
          <button type="button" className="secondary" onClick={() => startState('Devuelto')}>{STATE_ACTIONS.Devuelto.button}</button>
          <button type="button" className="secondary" onClick={() => startState('Retirado')}>{STATE_ACTIONS.Retirado.button}</button>
        </div>
        : <p className="help">Este hallazgo está {h.estado.toLowerCase()} y ya no se puede editar ni cambiar de estado.</p>)}
      {mode === 'edit' && renderEdit()}
      {STATE_ACTIONS[mode] && renderState()}

      <section aria-labelledby="history-title">
        <h3 id="history-title">Historial de estados</h3>
        {detail.historial.length
          ? <ol className="finding-history" aria-labelledby="history-title">
            {detail.historial.map(entry => <li key={entry.id}>
              {formatDateTime(entry.fecha)}: {entry.estadoAnterior} → <strong>{entry.estadoNuevo}</strong>
              {entry.motivo && <> · Motivo: {entry.motivo}</>}
            </li>)}
          </ol>
          : <p className="help">Sin cambios de estado. Publicado como Activo.</p>}
      </section>
    </article>;
  }

  return <main className="my-findings-page">
    <header>
      <a className="brand" href="#app">Lost&Found UEx</a>
      <p><a href="#app">Volver al inicio</a></p>
    </header>
    <section className="card" aria-labelledby="my-findings-title">
      <h1 id="my-findings-title">Mis hallazgos</h1>
      {selected
        ? <>
          <p><button type="button" className="secondary" onClick={back}>← Volver a mis hallazgos</button></p>
          {renderDetail()}
        </>
        : renderList()}
      {feedbackLine}
    </section>
  </main>;
}
