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
        pass: process.env.EMAIL_PASS // Tu contraseña de aplicación de Gmail
    }
});

// Enviar correo de confirmación
const sendConfirmationEmail = async (appointment) => {
    try {
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER, // Cambia esto al email del cliente si lo tienes
            subject: 'Confirmación de Cita con NailsCata',
            html: `
                <h1>¡Hola, ${appointment.nombre}!</h1>
                <p>Tu cita ha sido agendada con éxito.</p>
                <ul>
                    <li>**Servicio:** ${appointment.servicio}</li>
                    <li>**Fecha:** ${appointment.fecha}</li>
                    <li>**Hora:** ${appointment.hora}</li>
                    <li>**Nombre:** ${appointment.nombre}</li>
                    <li>**Teléfono:** ${appointment.telefono}</li>
                </ul>
                <p>¡Gracias por elegirnos!</p>
            `,
        };
        await transporter.sendMail(mailOptions);
        console.log('Correo de confirmación enviado.');
    } catch (error) {
        console.error('Error al enviar el correo de confirmación:', error);
    }
};

// Rutas de la API
app.get('/', (req, res) => {
    res.send('¡Hola desde el servidor de NailsCata!');
});

// RUTA PARA CREAR CITA (POST)
app.post('/api/appointments', async (req, res) => {
    const { nombre, telefono, service, date, time } = req.body;
    console.log('[DEBUG] Datos de la cita recibidos:', req.body);
    try {
        const result = await pool.query(
            'INSERT INTO appointments(nombre, telefono, servicio, fecha, hora) VALUES($1, $2, $3, $4, $5) RETURNING *;',
            [nombre, telefono, service, date, time]
        );
        const newAppointment = result.rows[0];
        console.log('[DEBUG] Cita creada en la base de datos:', newAppointment);
        sendConfirmationEmail(newAppointment); // Enviar correo
        res.status(201).json(newAppointment);
    } catch (err) {
        console.error('Error al agendar la cita:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al agendar la cita.' });
    }
});

// RUTA PARA CREAR/ACTUALIZAR HORARIO (POST)
app.post('/api/schedules', async (req, res) => {
    const { date, available_times } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO schedules(date, available_times) VALUES($1, $2) ON CONFLICT (date) DO UPDATE SET available_times = EXCLUDED.available_times RETURNING *;',
            [date, available_times]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error al guardar o actualizar horario:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al guardar o actualizar horario.' });
    }
});

// RUTA PARA OBTENER TODOS LOS TURNOS (GET)
app.get('/api/appointments', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM appointments ORDER BY fecha DESC, hora DESC;');
        res.json(result.rows);
    } catch (err) {
        console.error('Error al obtener los turnos:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al obtener los turnos.' });
    }
});

// RUTA PARA ELIMINAR UN TURNO POR ID (DELETE)
app.delete('/api/appointments/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM appointments WHERE id = $1 RETURNING *;', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Turno no encontrado.' });
        }
        res.status(200).json({ message: 'Turno eliminado con éxito.' });
    } catch (err) {
        console.error('Error al eliminar turno:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al eliminar turno.' });
    }
});

// RUTA PARA ELIMINAR UN HORARIO POR FECHA
app.delete('/api/schedules/:date', async (req, res) => {
    const { date } = req.params;
    try {
        const result = await pool.query('DELETE FROM schedules WHERE date = $1 RETURNING *;', [date]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Horario no encontrado para la fecha especificada.' });
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
    console.error('Error del servidor:', err.stack);
    res.status(500).json({ error: 'Algo salió mal en el servidor.' });
});

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});