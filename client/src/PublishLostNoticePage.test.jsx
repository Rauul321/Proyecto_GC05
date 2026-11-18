// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { AVISO_LEGAL, PublishLostNoticePage } from './PublishLostNoticePage.jsx';

// SCRUM-52 / US-013. Solo datos ficticios.
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const CATEGORIA = '11111111-1111-4111-8111-111111111111';
const FACULTAD = '22222222-2222-4222-8222-222222222222';
const OTRA_FACULTAD = '33333333-3333-4333-8333-333333333333';
const CENTRO = '44444444-4444-4444-8444-444444444444';
const OTRO_CENTRO = '55555555-5555-4555-8555-555555555555';
const OPTIONS = {
  categorias: [{ id: CATEGORIA, nombre: 'Mochilas y bolsos' }],
  facultades: [{ id: FACULTAD, nombre: 'Facultad Ficticia' }, { id: OTRA_FACULTAD, nombre: 'Otra Facultad Ficticia' }],
  centros: [
    { id: CENTRO, nombre: 'Biblioteca Ficticia', facultadId: FACULTAD },
    { id: OTRO_CENTRO, nombre: 'Aulario Ficticio', facultadId: OTRA_FACULTAD },
  ],
};
const ok = (data, status = 200) => ({ ok: true, status, json: async () => data });
const fail = (status, data = {}) => ({ ok: false, status, json: async () => data });

function stubFetch(...publishResponses) {
  const fetch = vi.fn(async (url) => {
    if (url === '/api/avisos/opciones') return ok(OPTIONS);
    return publishResponses.shift() ?? ok({ message: 'Aviso de pérdida publicado correctamente.', aviso: { id: 'id', estado: 'Activo' } }, 201);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

async function setup() {
  const user = userEvent.setup();
  render(<PublishLostNoticePage />);
  await screen.findByRole('button', { name: 'Publicar aviso' });
  return user;
}

async function fillRequired(user) {
  await user.selectOptions(screen.getByLabelText('Categoría'), CATEGORIA);
  await user.type(screen.getByLabelText('Descripción pública'), '  Mochila azul ficticia  ');
  await user.clear(screen.getByLabelText('Fecha aproximada de la pérdida'));
  await user.type(screen.getByLabelText('Fecha aproximada de la pérdida'), '2026-01-15');
  await user.selectOptions(screen.getByLabelText('Facultad donde lo perdiste'), FACULTAD);
}

const publishCalls = (fetch) => fetch.mock.calls.filter(([url]) => url === '/api/avisos');
const sentBody = (fetch) => JSON.parse(publishCalls(fetch)[0][1].body);
const submit = (user) => user.click(screen.getByRole('button', { name: 'Publicar aviso' }));

it('AC-01/AC-02: carga categorías, facultades y centros activos', async () => {
  stubFetch();
  await setup();
  expect(screen.getByRole('option', { name: 'Mochilas y bolsos' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Facultad Ficticia' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Biblioteca Ficticia' })).toBeInTheDocument();
  expect(screen.getByLabelText('Fecha aproximada de la pérdida')).toHaveAttribute('max');
});

it('AC-07: informa de que el aviso no inicia una solicitud ni implica custodia', async () => {
  stubFetch();
  await setup();
  expect(screen.getByText(AVISO_LEGAL)).toBeInTheDocument();
  expect(AVISO_LEGAL).toMatch(/no inicia una solicitud de recuperación/);
  expect(AVISO_LEGAL).toMatch(/bajo custodia de la Universidad/);
});

it('AC-02 a AC-06: envía los datos con los opcionales y limpia el formulario', async () => {
  const fetch = stubFetch();
  const user = await setup();
  await fillRequired(user);
  await user.selectOptions(screen.getByLabelText('Centro (opcional)'), CENTRO);
  await user.type(screen.getByLabelText('Rasgos identificativos privados (opcional)'), 'Llavero ficticio');
  await user.type(screen.getByLabelText('Correo de contacto'), 'contacto@example.com');
  await user.type(screen.getByLabelText('Teléfono de contacto'), '+34600000000');
  await submit(user);

  expect(await screen.findByText('Aviso de pérdida publicado correctamente.')).toBeInTheDocument();
  const [[url, options]] = publishCalls(fetch);
  expect(url).toBe('/api/avisos');
  expect(options.method).toBe('POST');
  expect(options.headers['Content-Type']).toBe('application/json');
  expect(sentBody(fetch)).toEqual({
    categoriaId: CATEGORIA, facultadId: FACULTAD, centroId: CENTRO, descripcion: 'Mochila azul ficticia',
    fechaPerdida: '2026-01-15', rasgosPrivados: 'Llavero ficticio',
    contactoEmail: 'contacto@example.com', contactoTelefono: '+34600000000',
  });
  expect(screen.getByLabelText('Descripción pública')).toHaveValue('');
  expect(screen.getByLabelText('Correo de contacto')).toHaveValue('');
});

it('AC-03/AC-04: los campos voluntarios vacíos se envían como null y nunca se mandan autor ni estado', async () => {
  const fetch = stubFetch();
  const user = await setup();
  await fillRequired(user);
  await submit(user);
  await screen.findByText('Aviso de pérdida publicado correctamente.');
  const body = sentBody(fetch);
  expect(body).toMatchObject({ centroId: null, rasgosPrivados: null, contactoEmail: null, contactoTelefono: null });
  expect(body).not.toHaveProperty('autorId');
  expect(body).not.toHaveProperty('estado');
});

it('AC-03: el contacto no se rellena con el correo de la cuenta', async () => {
  stubFetch();
  await setup();
  expect(screen.getByLabelText('Correo de contacto')).toHaveValue('');
  expect(screen.getByLabelText('Teléfono de contacto')).toHaveValue('');
});

it('AC-02: permite indicar solo el centro y el servidor obtiene la facultad', async () => {
  const fetch = stubFetch();
  const user = await setup();
  await user.selectOptions(screen.getByLabelText('Categoría'), CATEGORIA);
  await user.type(screen.getByLabelText('Descripción pública'), 'Paraguas ficticio');
  await user.selectOptions(screen.getByLabelText('Centro (opcional)'), OTRO_CENTRO);
  await submit(user);
  await screen.findByText('Aviso de pérdida publicado correctamente.');
  expect(sentBody(fetch)).toMatchObject({ facultadId: null, centroId: OTRO_CENTRO });
});

it('AC-05: solo ofrece los centros de la facultad elegida y quita un centro que ya no corresponde', async () => {
  stubFetch();
  const user = await setup();
  await user.selectOptions(screen.getByLabelText('Centro (opcional)'), OTRO_CENTRO);
  await user.selectOptions(screen.getByLabelText('Facultad donde lo perdiste'), FACULTAD);
  expect(screen.getByLabelText('Centro (opcional)')).toHaveValue('');
  expect(screen.queryByRole('option', { name: 'Aulario Ficticio' })).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Biblioteca Ficticia' })).toBeInTheDocument();
});

it('AC-05/AC-08: valida los campos obligatorios y no envía un aviso incompleto', async () => {
  const fetch = stubFetch();
  const user = await setup();
  await user.clear(screen.getByLabelText('Fecha aproximada de la pérdida'));
  await submit(user);
  expect(screen.getByText('Revisa los datos introducidos.')).toBeInTheDocument();
  expect(screen.getByText('Selecciona una categoría.')).toBeInTheDocument();
  expect(screen.getByText('Describe el objeto que has perdido.')).toBeInTheDocument();
  expect(screen.getByText('Indica la fecha aproximada en la que lo perdiste.')).toBeInTheDocument();
  expect(screen.getByText('Selecciona la facultad o el centro donde lo perdiste.')).toBeInTheDocument();
  expect(screen.getByLabelText('Descripción pública')).toHaveAttribute('aria-invalid', 'true');
  expect(publishCalls(fetch)).toHaveLength(0);
});

it.each([
  ['fecha futura', 'Fecha aproximada de la pérdida', '2999-01-01', 'La fecha no puede ser futura.'],
  ['correo no válido', 'Correo de contacto', 'correo-no-valido', 'El formato del correo de contacto no es válido.'],
  ['correo con puntos seguidos en el dominio', 'Correo de contacto', 'contacto@example..com', 'El formato del correo de contacto no es válido.'],
  ['teléfono no válido', 'Teléfono de contacto', '12345', 'Introduce 9 cifras, con el prefijo +34 opcional.'],
])('AC-05: rechaza %s sin enviar nada', async (_, label, value, expected) => {
  const fetch = stubFetch();
  const user = await setup();
  await fillRequired(user);
  await user.clear(screen.getByLabelText(label));
  await user.type(screen.getByLabelText(label), value);
  await submit(user);
  expect(screen.getByText(expected)).toBeInTheDocument();
  expect(publishCalls(fetch)).toHaveLength(0);
});

it('AC-05: rechaza una descripción demasiado larga', async () => {
  const fetch = stubFetch();
  const user = await setup();
  await fillRequired(user);
  const textarea = screen.getByLabelText('Descripción pública');
  textarea.removeAttribute('maxlength');
  await user.clear(textarea);
  await user.click(textarea);
  await user.paste('a'.repeat(2001));
  await submit(user);
  expect(screen.getByText('No puede superar los 2000 caracteres.')).toBeInTheDocument();
  expect(publishCalls(fetch)).toHaveLength(0);
});

it('AC-08: muestra los errores del servidor por campo y conserva los datos', async () => {
  stubFetch(fail(400, { message: 'Revisa los datos del aviso.', errors: { facultadId: 'La facultad no existe o está inactiva.' } }));
  const user = await setup();
  await fillRequired(user);
  await submit(user);
  expect(await screen.findByText('La facultad no existe o está inactiva.')).toBeInTheDocument();
  expect(screen.getByText('Revisa los datos del aviso.')).toBeInTheDocument();
  expect(screen.getByLabelText('Descripción pública')).toHaveValue('  Mochila azul ficticia  ');
});

it('si falla la red, avisa y no repite el envío automáticamente', async () => {
  const fetch = vi.fn(async (url) => {
    if (url === '/api/avisos/opciones') return ok(OPTIONS);
    throw new TypeError('Failed to fetch');
  });
  vi.stubGlobal('fetch', fetch);
  const user = await setup();
  await fillRequired(user);
  await submit(user);
  expect(await screen.findByText(/No se pudo conectar con el servidor/)).toBeInTheDocument();
  expect(publishCalls(fetch)).toHaveLength(1);
  expect(screen.getByLabelText('Descripción pública')).toHaveValue('  Mochila azul ficticia  ');
});

it('si la sesión caduca al publicar, ofrece volver a iniciar sesión', async () => {
  stubFetch(fail(401));
  const user = await setup();
  await fillRequired(user);
  await submit(user);
  expect(await screen.findByText(/Debes iniciar sesión para publicar un aviso/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', '#inicio-sesion');
});

it('evita los envíos duplicados mientras publica', async () => {
  let resolve;
  const fetch = vi.fn(async (url) => (url === '/api/avisos/opciones'
    ? ok(OPTIONS)
    : new Promise(done => { resolve = done; })));
  vi.stubGlobal('fetch', fetch);
  const user = await setup();
  await fillRequired(user);
  await submit(user);
  expect(screen.getByRole('button', { name: 'Publicando…' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Publicando…' }));
  expect(publishCalls(fetch)).toHaveLength(1);
  resolve(ok({ message: 'Aviso de pérdida publicado correctamente.' }, 201));
  expect(await screen.findByText('Aviso de pérdida publicado correctamente.')).toBeInTheDocument();
});

it('sin sesión no muestra el formulario y enlaza al inicio de sesión', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fail(401)));
  render(<PublishLostNoticePage />);
  expect(await screen.findByText(/Debes iniciar sesión para publicar un aviso/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Publicar aviso' })).not.toBeInTheDocument();
});

it('sin categorías o facultades configuradas no ofrece el formulario', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ categorias: [], facultades: OPTIONS.facultades, centros: [] })));
  render(<PublishLostNoticePage />);
  expect(await screen.findByText(/Todavía no hay categorías o facultades disponibles/)).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Publicar aviso' })).not.toBeInTheDocument());
});
