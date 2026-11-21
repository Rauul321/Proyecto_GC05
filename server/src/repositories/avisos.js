import { randomUUID } from 'node:crypto';
import { AvisoError } from '../services/avisos.js';

/** SCRUM-109. SQL parametrizado, catálogos activos y guardado atómico. */
export function createAvisoRepository(pool) {
  if (!pool) {
    const unavailable = async () => { throw new AvisoError(503, 'La publicación de avisos no está disponible en este momento.'); };
    return {
      options: unavailable,
      listForClosure: unavailable,
      close: unavailable,
      publish: unavailable,
      listActive: async () => {
        throw new AvisoError(503, 'La consulta de avisos no está disponible en este momento.');
      },
    };
  }
  return {
    async options() {
      const { rows: categorias } = await pool.query('SELECT id, nombre FROM categorias WHERE activo ORDER BY nombre, id');
      const { rows: facultades } = await pool.query('SELECT id, nombre FROM facultades WHERE activo ORDER BY nombre, id');
      const { rows: centros } = await pool.query(
        `SELECT c.id, c.nombre, c.facultad_id AS "facultadId" FROM centros c
         JOIN facultades f ON f.id = c.facultad_id WHERE c.activo AND f.activo ORDER BY c.nombre, c.id`);
      return { categorias, facultades, centros };
    },

    // SCRUM-57 / US-014: consulta paginada de avisos activos.
    // SCRUM-119 / US-015: el texto se busca solo en campos públicos (descripción, categoría,
    // facultad y centro), sin distinguir mayúsculas; nunca en aviso_datos_privados.
    async listActive(pagina = 1, tamano = 12, filtros = {}) {
      const { terminos = [], categoriaId = null, facultadId = null, centroId = null } = filtros;
      const offset = (pagina - 1) * tamano;
      const params = ['Activo'];
      const where = ['a.estado = $1'];
      const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
      // Cada palabra debe aparecer en algún campo público; %, _ y \ se buscan como texto literal.
      for (const termino of terminos) {
        add(`concat_ws(' ', a.descripcion, cat.nombre, f.nombre, c.nombre) ILIKE ?`,
          `%${termino.replace(/[\\%_]/g, '\\$&')}%`);
      }
      if (categoriaId) add('a.categoria_id = ?::uuid', categoriaId);
      if (facultadId) add('a.facultad_id = ?::uuid', facultadId);
      if (centroId) add('a.centro_id = ?::uuid', centroId);
      const from = `FROM avisos a
        JOIN categorias cat ON cat.id = a.categoria_id
        JOIN facultades f ON f.id = a.facultad_id
        LEFT JOIN centros c ON c.id = a.centro_id
        WHERE ${where.join(' AND ')}`;

      const { rows } = await pool.query(`SELECT COUNT(*)::int AS total ${from}`, params);

      const total = rows[0].total;

      const { rows: avisos } = await pool.query(
        `SELECT
          a.id,
          a.descripcion,
          a.fecha_perdida::text AS "fechaPerdida",
          a.estado,
          json_build_object(
            'id', cat.id,
            'nombre', cat.nombre
          ) AS categoria,
          json_build_object(
            'id', f.id,
            'nombre', f.nombre
          ) AS facultad,
          CASE
            WHEN c.id IS NULL THEN NULL
            ELSE json_build_object(
              'id', c.id,
              'nombre', c.nombre
            )
          END AS centro
        ${from}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, tamano, offset]
      );

      return { avisos, total };
    },

    async listForClosure(userId) {
      const { rows } = await pool.query(
        `SELECT id, descripcion, fecha_perdida::text AS "fechaPerdida", estado,
                cerrado_en AS "cerradoEn", motivo_cierre AS "motivoCierre"
         FROM avisos WHERE autor_id = $1 ORDER BY created_at DESC, id DESC`,
        [userId]
      );
      return rows;
    },

    async close(userId, id, motivo) {
      const { rows: [aviso] } = await pool.query(
        `UPDATE avisos
         SET estado = 'Cerrado', cerrado_en = CURRENT_TIMESTAMP,
             cerrado_por = $1, motivo_cierre = $3
         WHERE id = $2 AND autor_id = $1 AND estado = 'Activo'
         RETURNING id, estado, cerrado_en AS "cerradoEn", motivo_cierre AS "motivoCierre"`,
        [userId, id, motivo]
      );
      if (aviso) return aviso;

      const { rowCount } = await pool.query(
        'SELECT id FROM avisos WHERE id = $2 AND autor_id = $1', [userId, id]
      );
      if (!rowCount) throw new AvisoError(404, 'El aviso no existe.');
      throw new AvisoError(409, 'El aviso ya está cerrado.');
    },

    async publish(userId, data) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Revalidar dentro de la transacción, incluso si desactivan la cuenta tras requireAuth.
        const user = await client.query('SELECT id FROM usuarios WHERE id = $1 AND activo FOR SHARE', [userId]);
        if (!user.rowCount) throw new AvisoError(401, 'Debes iniciar sesión.');
        let facultadId = data.facultadId;
        const errors = {};
        if (data.centroId) {
          const { rows } = await client.query(
            `SELECT c.facultad_id FROM centros c JOIN facultades f ON f.id = c.facultad_id
             WHERE c.id = $1 AND c.activo AND f.activo FOR SHARE OF c, f`, [data.centroId]);
          if (!rows.length || (facultadId && facultadId !== rows[0].facultad_id)) {
            errors.centroId = 'El centro no existe, está inactivo o no pertenece a la facultad seleccionada.';
          } else facultadId = rows[0].facultad_id;
        }
        if (facultadId) {
          const faculty = await client.query('SELECT id FROM facultades WHERE id = $1 AND activo FOR SHARE', [facultadId]);
          if (!faculty.rowCount) errors.facultadId = 'La facultad no existe o está inactiva.';
        }
        const category = await client.query('SELECT id FROM categorias WHERE id = $1 AND activo FOR SHARE', [data.categoriaId]);
        if (!category.rowCount) errors.categoriaId = 'La categoría no existe o está inactiva.';
        if (Object.keys(errors).length) throw new AvisoError(400, 'Revisa los datos del aviso.', errors);
        const id = randomUUID();
        await client.query(
          `INSERT INTO avisos (id, autor_id, categoria_id, facultad_id, centro_id, descripcion, fecha_perdida, estado)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'Activo')`,
          [id, userId, data.categoriaId, facultadId, data.centroId, data.descripcion, data.fechaPerdida]);
        if (data.rasgosPrivados || data.contactoEmail || data.contactoTelefono) {
          await client.query(
            `INSERT INTO aviso_datos_privados (aviso_id, rasgos, contacto_email, contacto_telefono) VALUES ($1, $2, $3, $4)`,
            [id, data.rasgosPrivados, data.contactoEmail, data.contactoTelefono]);
        }
        await client.query('COMMIT');
        return { id };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
