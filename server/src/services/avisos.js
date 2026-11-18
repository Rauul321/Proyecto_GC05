import { validateAviso } from '../validation/avisos.js';

export class AvisoError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

export function createAvisoService(storage) {
  return {
    async options() {
      const { categorias, facultades, centros } = await storage.options();
      const option = ({ id, nombre }) => ({ id, nombre });
      return {
        categorias: categorias.map(option), facultades: facultades.map(option),
        centros: centros.map(({ id, nombre, facultadId }) => ({ id, nombre, facultadId })),
      };
    },

    // SCRUM-57 / US-014: servicio de consulta del feed de avisos.
    async listActive(query = {}) {
      const parseInteger = (value, defaultValue) => {
        if (value === undefined) return defaultValue;

        if (typeof value !== 'string' || !/^\d+$/.test(value)) {
          return Number.NaN;
        }

        return Number(value);
      };

      const pagina = parseInteger(query.pagina, 1);
      const tamano = parseInteger(query.tamano, 12);
      const errors = {};

      if (!Number.isSafeInteger(pagina) || pagina < 1) {
        errors.pagina = 'La página debe ser un entero mayor o igual a 1.';
      }

      if (!Number.isSafeInteger(tamano) || tamano < 1 || tamano > 50) {
        errors.tamano = 'El tamaño debe estar entre 1 y 50.';
      }

      if (Object.keys(errors).length) {
        throw new AvisoError(400, 'Revisa los parámetros de paginación.', errors);
      }

      const { avisos, total } = await storage.listActive(pagina, tamano);
      const totalPaginas = Math.ceil(total / tamano);

      if (pagina > Math.max(1, totalPaginas)) {
        throw new AvisoError(404, 'La página solicitada no existe.', {
          pagina: 'Selecciona una página válida.',
        });
      }

      return {
        avisos: avisos.map(aviso => ({
          id: aviso.id,
          categoria: {
            id: aviso.categoria.id,
            nombre: aviso.categoria.nombre,
          },
          facultad: {
            id: aviso.facultad.id,
            nombre: aviso.facultad.nombre,
          },
          centro: aviso.centro ? {
            id: aviso.centro.id,
            nombre: aviso.centro.nombre,
          } : null,
          descripcion: aviso.descripcion,
          fechaPerdida: aviso.fechaPerdida,
          estado: aviso.estado,
        })),
        paginacion: {
          pagina,
          tamano,
          total,
          totalPaginas,
          anterior: pagina > 1,
          siguiente: pagina < totalPaginas,
        },
        ...(total === 0 && {
          message: 'Todavía no hay avisos de pérdida activos.',
        }),
      };
    },

    async publish(userId, body) {
      const { errors, value } = validateAviso(body);
      if (Object.keys(errors).length) throw new AvisoError(400, 'Revisa los datos del aviso.', errors);
      const saved = await storage.publish(userId, value);
      // Lista explícita: ni correo, ni rasgos, ni datos del autor salen en la respuesta.
      return { message: 'Aviso de pérdida publicado correctamente.', aviso: { id: saved.id, estado: 'Activo' } };
    },
  };
}
