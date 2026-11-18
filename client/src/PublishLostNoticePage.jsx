import { useEffect, useRef, useState } from 'react';
import { getAvisoOptions, publishAviso } from './api/avisos.js';

// Mismos límites que el servidor (SCRUM-109).
const TEXT_MAX = 2000;
const EMAIL_MAX = 254;
const TELEFONO_PATTERN = /^(?:\+34)?[0-9]{9}$/;
// Partes del dominio sin puntos: evita el backtracking super-lineal (SonarCloud S8786).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export const AVISO_LEGAL = 'Este aviso no inicia una solicitud de recuperación ni implica que el objeto esté bajo custodia de la Universidad.';

function today() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const empty = () => ({
  categoriaId: '', facultadId: '', centroId: '', descripcion: '', fechaPerdida: today(),
  rasgosPrivados: '', contactoEmail: '', contactoTelefono: '',
});

const length = (text) => [...text].length;

/** US-013-AC-05: valida antes de enviar; el servidor vuelve a validarlo todo. */
function validate(form) {
  const errors = {};
  if (!form.categoriaId) errors.categoriaId = 'Selecciona una categoría.';
  if (!form.facultadId && !form.centroId) errors.facultadId = 'Selecciona la facultad o el centro donde lo perdiste.';
  if (!form.descripcion.trim()) errors.descripcion = 'Describe el objeto que has perdido.';
  else if (length(form.descripcion.trim()) > TEXT_MAX) errors.descripcion = `No puede superar los ${TEXT_MAX} caracteres.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.fechaPerdida)) errors.fechaPerdida = 'Indica la fecha aproximada en la que lo perdiste.';
  else if (form.fechaPerdida > today()) errors.fechaPerdida = 'La fecha no puede ser futura.';
  if (length(form.rasgosPrivados.trim()) > TEXT_MAX) errors.rasgosPrivados = `No puede superar los ${TEXT_MAX} caracteres.`;
  const email = form.contactoEmail.trim();
  if (email && (email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email))) errors.contactoEmail = 'El formato del correo de contacto no es válido.';
  const telefono = form.contactoTelefono.trim();
  if (telefono && !TELEFONO_PATTERN.test(telefono)) errors.contactoTelefono = 'Introduce 9 cifras, con el prefijo +34 opcional.';
  return errors;
}

/** Los campos opcionales vacíos se envían como null, como permite la API. */
function toPayload(form) {
  const optional = text => text.trim() || null;
  return {
    categoriaId: form.categoriaId,
    facultadId: form.facultadId || null,
    centroId: form.centroId || null,
    descripcion: form.descripcion.trim(),
    fechaPerdida: form.fechaPerdida,
    rasgosPrivados: optional(form.rasgosPrivados),
    contactoEmail: optional(form.contactoEmail),
    contactoTelefono: optional(form.contactoTelefono),
  };
}

/** SCRUM-52 / US-013 · Publicar un aviso de pérdida. */
export function PublishLostNoticePage() {
  const [options, setOptions] = useState(null);
  const [status, setStatus] = useState('loading');
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState({ text: '', ok: false, login: false });
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const feedback = useRef(null);

  useEffect(() => {
    getAvisoOptions()
      .then(data => {
        setOptions({ categorias: data?.categorias ?? [], facultades: data?.facultades ?? [], centros: data?.centros ?? [] });
        setStatus('ready');
      })
      .catch(error => { setStatus(error.status === 401 ? 'unauthenticated' : 'error'); setMessage({ text: error.message, ok: false, login: false }); });
  }, []);

  useEffect(() => {
    if (message.text) feedback.current?.focus();
  }, [message]);

  const change = field => event => setForm(current => ({ ...current, [field]: event.target.value }));

  // Si se cambia la facultad, el centro elegido tiene que seguir siendo de esa facultad.
  function changeFacultad(event) {
    const facultadId = event.target.value;
    setForm(current => {
      const centro = options.centros.find(item => item.id === current.centroId);
      const keepCentro = centro && (!facultadId || centro.facultadId === facultadId);
      return { ...current, facultadId, centroId: keepCentro ? current.centroId : '' };
    });
  }

  async function submit(event) {
    event.preventDefault();
    if (busy.current) return;
    setErrors({});
    setMessage({ text: '', ok: false, login: false });

    const validationErrors = validate(form);
    if (Object.keys(validationErrors).length) {
      setErrors(validationErrors);
      setMessage({ text: 'Revisa los datos introducidos.', ok: false, login: false });
      return;
    }

    busy.current = true;
    setSaving(true);
    try {
      // Un solo intento: si falla la red no se repite, porque el aviso podría haberse guardado.
      const data = await publishAviso(toPayload(form));
      setForm(empty());
      setMessage({ text: data?.message || 'Aviso de pérdida publicado correctamente.', ok: true, login: false });
    } catch (error) {
      setErrors(error.errors || {});
      setMessage({ text: error.message, ok: false, login: error.status === 401 });
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  const describedBy = (name, help) => [help && `aviso-${name}-help`, errors[name] && `aviso-${name}-error`].filter(Boolean).join(' ') || undefined;
  const fieldError = name => errors[name] && <p id={`aviso-${name}-error`} className="error">{errors[name]}</p>;
  const common = name => ({
    id: `aviso-${name}`, name, value: form[name], onChange: change(name), disabled: saving,
    'aria-invalid': Boolean(errors[name]),
  });

  const feedbackLine = <p ref={feedback} role="status" aria-live="polite" tabIndex="-1" className={message.ok ? 'success' : 'error'}>
    {message.text}{message.login && <> <a href="#inicio-sesion">Iniciar sesión</a></>}
  </p>;

  let content;
  if (status === 'loading') content = <p role="status">Cargando el formulario…</p>;
  else if (status === 'unauthenticated') content = <p className="error">Debes iniciar sesión para publicar un aviso. <a href="#inicio-sesion">Iniciar sesión</a></p>;
  else if (status === 'error') content = feedbackLine;
  else if (!options.categorias.length || (!options.facultades.length && !options.centros.length)) {
    content = <p className="error">Todavía no hay categorías o facultades disponibles, así que no se puede publicar. Avisa a la administración.</p>;
  } else {
    const centros = form.facultadId ? options.centros.filter(item => item.facultadId === form.facultadId) : options.centros;
    content = <form onSubmit={submit} aria-busy={saving} noValidate>
      <label htmlFor="aviso-categoriaId">Categoría</label>
      <select {...common('categoriaId')} aria-describedby={describedBy('categoriaId')}>
        <option value="">Selecciona una categoría</option>
        {options.categorias.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}
      </select>
      {fieldError('categoriaId')}

      <label htmlFor="aviso-descripcion">Descripción pública</label>
      <textarea {...common('descripcion')} rows={4} maxLength={TEXT_MAX} aria-describedby={describedBy('descripcion', true)} />
      <p id="aviso-descripcion-help" className="help">Visible para todos. No incluyas datos que solo conozcas tú.</p>
      {fieldError('descripcion')}

      <label htmlFor="aviso-fechaPerdida">Fecha aproximada de la pérdida</label>
      <input {...common('fechaPerdida')} type="date" max={today()} aria-describedby={describedBy('fechaPerdida')} />
      {fieldError('fechaPerdida')}

      <label htmlFor="aviso-facultadId">Facultad donde lo perdiste</label>
      <select {...common('facultadId')} onChange={changeFacultad} aria-describedby={describedBy('facultadId', true)}>
        <option value="">Selecciona una facultad</option>
        {options.facultades.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}
      </select>
      <p id="aviso-facultadId-help" className="help">Indica la facultad, el centro o ambos.</p>
      {fieldError('facultadId')}

      {options.centros.length > 0 && <>
        <label htmlFor="aviso-centroId">Centro (opcional)</label>
        <select {...common('centroId')} aria-describedby={describedBy('centroId')}>
          <option value="">Sin centro concreto</option>
          {centros.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}
        </select>
        {fieldError('centroId')}
      </>}

      <label htmlFor="aviso-rasgosPrivados">Rasgos identificativos privados (opcional)</label>
      <textarea {...common('rasgosPrivados')} rows={3} maxLength={TEXT_MAX} aria-describedby={describedBy('rasgosPrivados', true)} />
      <p id="aviso-rasgosPrivados-help" className="help">No se mostrarán en el listado público de avisos.</p>
      {fieldError('rasgosPrivados')}

      <fieldset className="contact-fields" aria-describedby="aviso-contacto-help">
        <legend>Contacto adicional (opcional)</legend>
        <p id="aviso-contacto-help" className="help">Solo si quieres dejar otra forma de contactarte. No se rellena con el correo de tu cuenta.</p>
        <label htmlFor="aviso-contactoEmail">Correo de contacto</label>
        <input {...common('contactoEmail')} type="email" maxLength={EMAIL_MAX} autoComplete="off" aria-describedby={describedBy('contactoEmail')} />
        {fieldError('contactoEmail')}
        <label htmlFor="aviso-contactoTelefono">Teléfono de contacto</label>
        <input {...common('contactoTelefono')} type="tel" autoComplete="off" aria-describedby={describedBy('contactoTelefono')} />
        {fieldError('contactoTelefono')}
      </fieldset>

      <p className="aviso-legal" role="note">{AVISO_LEGAL}</p>

      <div className="actions">
        <button type="submit" disabled={saving}>{saving ? 'Publicando…' : 'Publicar aviso'}</button>
      </div>
    </form>;
  }

  return <main className="publish-finding">
    <header>
      <a className="brand" href="#app">Lost&Found UEx</a>
      <p><a href="#app">Volver al inicio</a></p>
    </header>
    <section className="card" aria-labelledby="aviso-title">
      <h1 id="aviso-title">Publicar un aviso de pérdida</h1>
      <p className="help">Los campos sin «opcional» son obligatorios.</p>
      {content}
      {status === 'ready' && feedbackLine}
    </section>
  </main>;
}
