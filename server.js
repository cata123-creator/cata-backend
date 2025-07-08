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
    origin: ['https://nailscata1.netlify.app', 'http://localhost:3000'] // podés agregar más si querés
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
        pass: process.env.EMAIL_PASS  // Tu contraseña de aplicación de Gmail
    }
});

// Rutas para turnos
// GET /api/appointments - Obtener todas las citas
app.get('/api/appointments', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM appointments ORDER BY fecha, hora;');
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error al obtener citas:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al obtener citas.' });
    }
});

// POST /api/appointments - Crear una nueva cita
app.post('/api/appointments', async (req, res) => {
    const { nombre, telefono, servicio, fecha, hora, message } = req.body;

    // Validación básica de datos
    if (!nombre || !telefono || !servicio || !fecha || !hora) {
        return res.status(400).json({ error: 'Todos los campos obligatorios deben ser proporcionados.' });
    }

    try {
        // Verificar si ya existe un turno para esa fecha y hora
        const existingAppointment = await pool.query(
            'SELECT * FROM appointments WHERE fecha = $1 AND hora = $2;',
            [fecha, hora]
        );

        if (existingAppointment.rows.length > 0) {
            return res.status(409).json({ error: 'Ya existe un turno agendado para esta fecha y hora.' });
        }

        // Insertar la nueva cita en la base de datos
        const result = await pool.query(
            'INSERT INTO appointments (nombre, telefono, servicio, fecha, hora, message) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;',
            [nombre, telefono, servicio, fecha, hora, message]
        );

        const newAppointment = result.rows[0];

        // Enviar correo de confirmación (opcional, puedes mover esto a una función separada)
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: process.env.ADMIN_EMAIL, // Envía la notificación a tu correo de administrador
            subject: 'Nueva Cita Agendada - NailsCata',
            html: `
                <p>Se ha agendado una nueva cita:</p>
                <ul>
                    <li><strong>Nombre:</strong> ${newAppointment.nombre}</li>
                    <li><strong>Teléfono:</strong> ${newAppointment.telefono}</li>
                    <li><strong>Servicio:</strong> ${newAppointment.servicio}</li>
                    <li><strong>Fecha:</strong> ${newAppointment.fecha.toLocaleDateString('es-AR')}</li>
                    <li><strong>Hora:</strong> ${newAppointment.hora}</li>
                    <li><strong>Mensaje:</strong> ${newAppointment.message || 'N/A'}</li>
                </ul>
                <p>Por favor, revisa el sistema de gestión de turnos.</p>
            `
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error('Error al enviar correo:', error);
            } else {
                console.log('Correo enviado:', info.response);
            }
        });

        res.status(201).json(newAppointment);

    } catch (err) {
        console.error('Error al crear cita:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al crear cita.' });
    }
});

// PUT /api/appointments/:id - Actualizar una cita existente
app.put('/api/appointments/:id', async (req, res) => {
    const { id } = req.params;
    const { nombre, telefono, servicio, fecha, hora, message } = req.body;

    if (!nombre || !telefono || !servicio || !fecha || !hora) {
        return res.status(400).json({ error: 'Todos los campos obligatorios deben ser proporcionados.' });
    }

    try {
        // Opcional: Verificar si el nuevo horario colisiona con otro turno existente (excluyendo el turno actual)
        const existingAppointment = await pool.query(
            'SELECT * FROM appointments WHERE fecha = $1 AND hora = $2 AND id != $3;',
            [fecha, hora, id]
        );

        if (existingAppointment.rows.length > 0) {
            return res.status(409).json({ error: 'Ya existe otro turno agendado para esta fecha y hora.' });
        }

        const result = await pool.query(
            'UPDATE appointments SET nombre = $1, telefono = $2, servicio = $3, fecha = $4, hora = $5, message = $6 WHERE id = $7 RETURNING *;',
            [nombre, telefono, servicio, fecha, hora, message, id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Cita no encontrada.' });
        }
        res.status(200).json(result.rows[0]);
    } catch (err) {
        console.error('Error al actualizar cita:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al actualizar cita.' });
    }
});

// DELETE /api/appointments/:id - Eliminar una cita por ID
app.delete('/api/appointments/:id', async (req, res) => {
    console.log(`[DEBUG] Solicitud DELETE recibida para /api/appointments/${req.params.id}`);

    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM appointments WHERE id = $1 RETURNING *;', [id]);
        if (result.rowCount === 0) {
            console.log(`[DEBUG] Cita con ID ${id} no encontrada.`);
            return res.status(404).json({ error: 'Cita no encontrada.' });
        }
        console.log(`[DEBUG] Cita con ID ${id} eliminada con éxito.`);
        res.status(200).json({ message: 'Cita eliminada con éxito.', deletedAppointment: result.rows[0] });
    } catch (err) {
        console.error('Error al eliminar cita:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al eliminar cita.' });
    }
});

// Rutas para horarios
// GET /api/schedules - Obtener todos los horarios
app.get('/api/schedules', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM schedules ORDER BY date;');
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error al obtener horarios:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al obtener horarios.' });
    }
});

// POST /api/schedules - Crear o actualizar horario para una fecha específica
app.post('/api/schedules', async (req, res) => {
    const { date, available_times } = req.body; // La fecha debe venir en formato YYYY-MM-DD
    if (!date || !Array.isArray(available_times)) {
        return res.status(400).json({ error: 'Fecha y horarios disponibles son requeridos y deben ser un array.' });
    }

    try {
        // Usar INSERT ... ON CONFLICT para insertar o actualizar si la fecha ya existe
        const result = await pool.query(
            'INSERT INTO schedules (date, available_times) VALUES ($1, $2) ON CONFLICT (date) DO UPDATE SET available_times = $2 RETURNING *;',
            [date, available_times]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error al guardar horario:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al guardar horario.' });
    }
});

// GET /api/schedules/:date - Obtener horario para una fecha específica
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
    res.status(500).send('Algo salió mal!');
});

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
});