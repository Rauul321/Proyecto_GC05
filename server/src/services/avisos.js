import { validateAviso, validateBusquedaAvisos } from '../validation/avisos.js';

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
    // SCRUM-119 / US-015: búsqueda por texto y filtros por categoría, facultad y centro.
    async listActive(query = {}) {
      const { errors, soloPaginacion, value } = validateBusquedaAvisos(query);

      if (Object.keys(errors).length) {
        throw new AvisoError(400,
          soloPaginacion ? 'Revisa los parámetros de paginación.' : 'Revisa los filtros de búsqueda.', errors);
      }

      const { pagina, tamano, filtros } = value;
      const conFiltros = filtros.terminos.length > 0 ||
        Boolean(filtros.categoriaId || filtros.facultadId || filtros.centroId);
      const { avisos, total } = await storage.listActive(pagina, tamano, filtros);
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
          message: conFiltros
            ? 'No hay avisos activos que coincidan con la búsqueda.'
            : 'Todavía no hay avisos de pérdida activos.',
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
