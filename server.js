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

// Ruta para agendar un turno
app.post('/api/appointments', async (req, res) => {
    const { date, time, name, service, email, phone } = req.body;
    
    // VERIFICACIÓN: Ver la fecha que llega desde el cliente
    console.log('[DEBUG] Fecha recibida para agendar:', date);

    if (!date || !time || !name || !service || !email || !phone) {
        return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const newAppointment = await client.query(
            'INSERT INTO appointments (date, time, name, service, email, phone) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;',
            [date, time, name, service, email, phone]
        );

        await client.query(
            'UPDATE schedules SET available_times = array_remove(available_times, $1) WHERE date = $2;',
            [time, date]
        );

        // ENVIAR EL CORREO ELECTRÓNICO (con la versión de texto plano)
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Confirmación de Cita - NailsCata',
            text: `¡Hola ${name}!\n\nTu cita ha sido agendada con éxito.\n\nDetalles de la cita:\nFecha: ${date}\nHora: ${time}\nServicio: ${service}\n\n¡Te esperamos!\n\nAtentamente,\nNailsCata`
        };

        await transporter.sendMail(mailOptions);
        console.log('[INFO] Correo de confirmación enviado a:', email);

        await client.query('COMMIT');
        res.status(201).json(newAppointment.rows[0]);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error al agendar cita o enviar correo:', err);
        res.status(500).json({ error: 'Error al agendar la cita. Por favor, intenta de nuevo más tarde.' });
    } finally {
        client.release();
    }
});

// Ruta para obtener todos los turnos agendados
app.get('/api/appointments', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM appointments ORDER BY date, time;');
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error al obtener turnos:', err.message);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// Ruta para eliminar un turno
app.delete('/api/appointments/:id', async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Obtenemos los detalles del turno para restaurar el horario
        const result = await client.query('SELECT date, time FROM appointments WHERE id = $1;', [id]);
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Turno no encontrado.' });
        }
        const { date, time } = result.rows[0];

        // Eliminar el turno de la tabla de citas
        await client.query('DELETE FROM appointments WHERE id = $1;', [id]);

        // Agregar el horario de vuelta a la tabla de horarios disponibles
        await client.query(
            'UPDATE schedules SET available_times = array_append(available_times, $1) WHERE date = $2;',
            [time, date]
        );

        await client.query('COMMIT');
        res.status(200).json({ message: 'Turno eliminado con éxito.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error al eliminar el turno:', err);
        res.status(500).json({ error: 'Error interno del servidor al eliminar turno.' });
    } finally {
        client.release();
    }
});

// Ruta para guardar o actualizar horarios
app.post('/api/schedules', async (req, res) => {
    const { date, available_times } = req.body;
    
    const client = await pool.connect();
    try {
        const result = await client.query(
            'INSERT INTO schedules (date, available_times) VALUES ($1, $2) ON CONFLICT (date) DO UPDATE SET available_times = $2;',
            [date, available_times]
        );
        res.status(201).json({ message: 'Horario guardado con éxito.' });
    } catch (err) {
        console.error('Error al guardar o actualizar horario:', err.message);
        res.status(500).json({ error: 'Error interno del servidor.' });
    } finally {
        client.release();
    }
});

// Ruta para eliminar horarios por fecha
app.delete('/api/schedules/:date', async (req, res) => {
    const { date } = req.params;
    try {
        const result = await pool.query('DELETE FROM schedules WHERE date = $1 RETURNING *;', [date]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'No se encontró horario para eliminar.' });
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
    console.log(`Servidor escuchando en http://localhost:${PORT}`);
});