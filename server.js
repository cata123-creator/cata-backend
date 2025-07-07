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
    origin: ['https://nailscata1.netlify.app', 'http://localhost:3000']  // podés agregar más si querés
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
        user: process.env.EMAIL_USER, // Tu dirección de Gmail (ej. tu_email@gmail.com)
        pass: process.env.EMAIL_PASS  // Tu contraseña de aplicación de Gmail (no tu contraseña normal)
    }
});

// Ruta de prueba
app.get('/', (req, res) => {
    res.send('Servidor de NailsCata está funcionando. ¡Bienvenido!');
});

// POST /api/appointments - Agendar una nueva cita
app.post('/api/appointments', async (req, res) => {
    const { nombre, telefono, servicio, fecha, hora, message } = req.body;
    try {
        // Verificar si la fecha y hora ya están ocupadas
        const existingAppointment = await pool.query(
            'SELECT * FROM appointments WHERE fecha = $1 AND hora = $2',
            [fecha, hora]
        );

        if (existingAppointment.rows.length > 0) {
            return res.status(409).json({ error: 'La fecha y hora seleccionadas ya están ocupadas.' });
        }

        // Insertar la nueva cita
        const result = await pool.query(
            'INSERT INTO appointments (nombre, telefono, servicio, fecha, hora, message) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [nombre, telefono, servicio, fecha, hora, message]
        );

        // Enviar correo electrónico de confirmación
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER, // Puedes enviar al cliente también si tienes su email
            subject: 'Nueva Cita Agendada en NailsCata',
            html: `
                <p><strong>Detalles de la Cita:</strong></p>
                <ul>
                    <li><strong>Nombre:</strong> ${nombre}</li>
                    <li><strong>Teléfono:</strong> ${telefono}</li>
                    <li><strong>Servicio:</strong> ${servicio}</li>
                    <li><strong>Fecha:</strong> ${fecha}</li>
                    <li><strong>Hora:</strong> ${hora}</li>
                    <li><strong>Mensaje:</strong> ${message || 'N/A'}</li>
                </ul>
                <p>¡Gracias por tu reserva!</p>
            `
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error('Error al enviar el correo:', error);
            } else {
                console.log('Correo enviado:', info.response);
            }
        });

        res.status(201).json(result.rows[0]); // Devolver la cita creada
    } catch (err) {
        console.error('Error al agendar la cita:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al agendar la cita.' });
    }
});

// GET /api/appointments - Obtener todas las citas (útil para la gestión)
app.get('/api/appointments', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM appointments ORDER BY fecha ASC, hora ASC');
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error al obtener citas:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al obtener citas.' });
    }
});

// GET /api/available-times - Obtener horarios disponibles para una fecha específica
app.get('/api/available-times', async (req, res) => {
    const { date } = req.query; // La fecha viene en formato YYYY-MM-DD
    console.log(`[DEBUG] Recibida solicitud para fecha: ${date}`); // NUEVO LOG
    try {
        // 1. Obtener todos los horarios configurados para la fecha
        const scheduleResult = await pool.query('SELECT available_times FROM schedules WHERE date = $1', [date]);

        if (scheduleResult.rows.length === 0) {
            console.log(`[DEBUG] No se encontró horario configurado para ${date}.`); // NUEVO LOG
            return res.status(200).json({ availableTimes: [] });
        }

        let allAvailableTimes = scheduleResult.rows[0].available_times;
        console.log(`[DEBUG] Horarios configurados (allAvailableTimes):`, allAvailableTimes); // NUEVO LOG

        // 2. Obtener los horarios ya ocupados (citas) para la fecha
        const occupiedResult = await pool.query('SELECT hora FROM appointments WHERE fecha = $1', [date]);
        let occupiedTimes = occupiedResult.rows.map(row => row.hora);
        console.log(`[DEBUG] Horarios ocupados (occupiedTimes):`, occupiedTimes); // NUEVO LOG

        // 3. Filtrar los horarios ocupados de los disponibles
        let finalAvailableTimes = allAvailableTimes.filter(time => !occupiedTimes.includes(time));
        console.log(`[DEBUG] Horarios finales disponibles (finalAvailableTimes):`, finalAvailableTimes); // NUEVO LOG

        res.status(200).json({ availableTimes: finalAvailableTimes });

    } catch (err) {
        console.error('Error al obtener horarios disponibles:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al obtener horarios disponibles.' });
    }
});

// POST /api/schedules - Guardar o actualizar horarios para una fecha
app.post('/api/schedules', async (req, res) => {
    const { date, availableTimes } = req.body; // availableTimes es un array de strings (ej. ["09:00", "10:00"])
    try {
        const result = await pool.query(
            'INSERT INTO schedules (date, available_times) VALUES ($1, $2) ON CONFLICT (date) DO UPDATE SET available_times = EXCLUDED.available_times RETURNING *;',
            [date, availableTimes]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error al guardar/actualizar horario:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al guardar/actualizar el horario.' });
    }
});

// GET /api/schedules - Obtener todos los horarios configurados (útil para la gestión)
app.get('/api/schedules', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM schedules ORDER BY date ASC;');
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error al obtener horarios configurados:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al obtener horarios configurados.' });
    }
});

// GET /api/schedules/:date - Obtener un horario específico por fecha
app.get('/api/schedules/:date', async (req, res) => {
    const { date } = req.params; // La fecha viene en formato YYYY-MM-DD
    try {
        const result = await pool.query('SELECT * FROM schedules WHERE date = $1;', [date]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Horario para la fecha no encontrado.' });
        }
        res.status(200).json({ schedule: result.rows[0] });
    } catch (err) {
        console.error('Error al obtener horario por fecha:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al obtener horario por fecha.' });
    }
});

// DELETE /api/schedules/:date - Eliminar el horario configurado para una fecha
app.delete('/api/schedules/:date', async (req, res) => {
    const { date } = req.params; // La fecha viene en formato YYYY-MM-DD
    try {
        const result = await pool.query('DELETE FROM schedules WHERE date = $1 RETURNING *;', [date]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Horario para la fecha no encontrado.' });
        }
        res.status(200).json({ message: 'Horario de la fecha eliminado con éxito.', deletedSchedule: result.rows[0] });
    } catch (err) {
        console.error('Error al eliminar horario por fecha:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al eliminar horario por fecha.' });
    }
});


// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
});