// Cargar variables de entorno desde el archivo .env
require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000; // Usa el puerto de las variables de entorno o 3000 por defecto

// Middleware
app.use(cors()); // Permite solicitudes de diferentes orígenes (necesario para el frontend)
app.use(express.json()); // Permite al servidor entender JSON en el cuerpo de las solicitudes

// Configuración de la conexión a la base de datos PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Importante para conexiones a bases de datos en la nube como Render
    }
});

// Test de conexión a la base de datos (opcional, pero buena práctica)
pool.connect()
    .then(client => {
        console.log('Conectado exitosamente a PostgreSQL');
        client.release(); // Libera el cliente de vuelta al pool
    })
    .catch(err => {
        console.error('Error al conectar a PostgreSQL:', err.message);
        console.error('Connection string:', process.env.DATABASE_URL);
    });

// Ruta de prueba
app.get('/', (req, res) => {
    res.send('Backend de NailsCata funcionando!');
});

// =========================================================
// RUTAS PARA LA GESTIÓN DE TURNOS DE NAILSCATA
// =========================================================

// GET /api/appointments - Obtener todos los turnos agendados
app.get('/api/appointments', async (req, res) => {
    try {
        const result = await pool.query('SELECT fecha, hora, servicio FROM turnos_nailscata');
        // El frontend solo necesita saber qué combinaciones de fecha-hora-servicio están ocupadas
        // O simplemente fecha y hora si el UNIQUE constraint es solo fecha y hora
        res.json({ reservedSlots: result.rows });
    } catch (err) {
        console.error('Error al obtener turnos:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al obtener turnos' });
    }
});

// POST /api/appointments - Agendar un nuevo turno
app.post('/api/appointments', async (req, res) => {
    const { fecha, hora, servicio, nombre, email, message } = req.body;

    // Validar datos de entrada (simple)
    if (!fecha || !hora || !servicio || !nombre || !email) {
        return res.status(400).json({ error: 'Faltan campos obligatorios para agendar el turno.' });
    }

    try {
        const query = `
            INSERT INTO turnos_nailscata (fecha, hora, servicio, nombre, email, message)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *;
        `;
        const values = [fecha, hora, servicio, nombre, email, message || null]; // message puede ser null

        const result = await pool.query(query, values);
        res.status(201).json({ 
            message: 'Turno agendado con éxito', 
            appointment: result.rows[0] 
        });

    } catch (err) {
        console.error('Error al agendar turno:', err.message);
        // Manejo de error específico para UNIQUE constraint
        if (err.code === '23505') { // Código de error para unique_violation en PostgreSQL
            return res.status(409).json({ error: 'Ya existe un turno agendado para esta fecha y hora.' });
        }
        res.status(500).json({ error: 'Error interno del servidor al agendar turno.' });
    }
});

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor backend de NailsCata corriendo en http://localhost:${PORT}`);
});