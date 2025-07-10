// Cargar variables de entorno desde el archivo .env
require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const nodemailer = require('nodemailer'); // Importa nodemailer

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: ['https://nailscata1.netlify.app', 'http://localhost:3000']
}));
app.use(express.json());

// Configuración de la conexión a la base de datos PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Test de conexión a la base de datos (opcional, pero buena práctica)
pool.connect()
    .then(client => {
        console.log('Conectado exitosamente a PostgreSQL');
        client.release();
    })
    .catch(err => {
        console.error('Error al conectar a PostgreSQL:', err.message);
        console.error('Connection string:', process.env.DATABASE_URL);
    });

// Configuración de Nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// RUTA: Agendar una cita
app.post('/api/appointments', async (req, res) => {
    const { nombre, telefono, service, date, time } = req.body;
    console.log('[DEBUG] Datos de la cita recibidos:', { nombre, telefono, service, date, time });

    try {
        const result = await pool.query(
            'INSERT INTO appointments(nombre, telefono, servicio, fecha, hora) VALUES($1, $2, $3, $4, $5) RETURNING *;', [name, phone, service, date, time]
        );
        const newAppointment = result.rows[0];
        console.log('[DEBUG] Cita creada en la base de datos:', newAppointment);

        res.status(201).json(newAppointment);

    } catch (err) {
        console.error('Error al agendar la cita:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al agendar la cita.' });
    }
});

// RUTA: Obtener todos los turnos agendados
app.get('/api/appointments', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM appointments ORDER BY created_at DESC;');
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error al obtener los turnos:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al obtener los turnos.' });
    }
});

// RUTA: Eliminar un turno por ID
app.delete('/api/appointments/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM appointments WHERE id = $1 RETURNING *;', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Turno no encontrado.' });
        }
        res.status(200).json({ message: 'Turno eliminado con éxito.' });
    } catch (err) {
        console.error('Error al eliminar turno:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al eliminar el turno.' });
    }
});

// RUTA: Crear o actualizar un horario disponible
app.post('/api/schedules', async (req, res) => {
    const { date, available_times } = req.body;
    try {
        const existingSchedule = await pool.query('SELECT * FROM schedules WHERE date = $1;', [date]);
        if (existingSchedule.rows.length > 0) {
            // Si ya existe, actualizar el array de horarios
            const result = await pool.query(
                'UPDATE schedules SET available_times = $1 WHERE date = $2 RETURNING *;', [available_times, date]
            );
            return res.status(200).json(result.rows[0]);
        } else {
            // Si no existe, crear un nuevo registro
            const result = await pool.query(
                'INSERT INTO schedules(date, available_times) VALUES($1, $2) RETURNING *;', [date, available_times]
            );
            return res.status(201).json(result.rows[0]);
        }
    } catch (err) {
        console.error('Error al guardar horario:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al guardar el horario.' });
    }
});

// RUTA: Obtener un horario disponible por fecha
app.get('/api/schedules/:date', async (req, res) => {
    const { date } = req.params;
    try {
        const result = await pool.query('SELECT * FROM schedules WHERE date = $1;', [date]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Horario no encontrado para esta fecha.' });
        }
        res.status(200).json(result.rows[0]);
    } catch (err) {
        console.error('Error al obtener el horario:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al obtener el horario.' });
    }
});

// RUTA: Eliminar un horario por fecha
app.delete('/api/schedules/:date', async (req, res) => {
    const { date } = req.params;
    try {
        const result = await pool.query('DELETE FROM schedules WHERE date = $1 RETURNING *;', [date]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Horario no encontrado para eliminar.' });
        }
        res.status(200).json({ message: 'Horario eliminado con éxito.' });
    } catch (err) {
        console.error('Error al eliminar horario por fecha:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al eliminar horario por fecha.' });
    }
});

// RUTA MODIFICADA: Ahora espera la fecha como un parámetro de ruta
app.get('/api/available-times/:date', async (req, res) => {
    const { date } = req.params; // Obtenemos la fecha de req.params
    console.log(`[DEBUG] Recibida solicitud GET para /api/available-times con fecha (param): ${date}`);

    try {
        const result = await pool.query('SELECT available_times FROM schedules WHERE date = $1;', [date]);
        if (result.rows.length === 0) {
            console.log(`[DEBUG] No se encontró horario configurado para la fecha ${date}.`);
            // Devolver un array vacío si no hay horarios configurados para la fecha
            return res.status(200).json([]);
        }
        res.status(200).json(result.rows[0].available_times);
    } catch (err) {
        console.error('Error al obtener horarios disponibles:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al obtener horarios disponibles.' });
    }
});


// Middleware para manejar rutas no encontradas (404)
app.use((req, res, next) => {
    res.status(404).json({ error: 'Ruta no encontrada.' });
});

// Manejador de errores global
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Algo salió mal. Por favor, intenta de nuevo más tarde.' });
});

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});