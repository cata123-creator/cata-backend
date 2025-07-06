// Cargar variables de entorno desde el archivo .env
require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const nodemailer = require('nodemailer'); // ¡NUEVO! Importa nodemailer

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
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

// ¡NUEVO! Configuración de Nodemailer
// Usaremos Gmail como ejemplo. Asegúrate de generar una "Contraseña de aplicación" para tu cuenta de Google.
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER, // Tu dirección de Gmail (ej. tu_email@gmail.com)
        pass: process.env.EMAIL_PASS  // Tu Contraseña de Aplicación de Gmail
    }
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
        const values = [fecha, hora, servicio, nombre, email, message || null];

        const result = await pool.query(query, values);
        const newAppointment = result.rows[0]; // El turno recién agendado

        // ¡NUEVO! Enviar notificación por correo electrónico
        const mailOptions = {
            from: process.env.EMAIL_USER, // Desde tu Gmail
            to: process.env.EMAIL_USER,   // A tu mismo Gmail (o a otro correo si quieres)
            subject: 'Nuevo Turno Agendado en NailsCata',
            html: `
                <p>¡Hola!</p>
                <p>Se ha agendado un nuevo turno en NailsCata:</p>
                <ul>
                    <li><strong>Nombre:</strong> ${newAppointment.nombre}</li>
                    <li><strong>Email:</strong> ${newAppointment.email}</li>
                    <li><strong>Servicio:</strong> ${newAppointment.servicio}</li>
                    <li><strong>Fecha:</strong> ${newAppointment.fecha}</li>
                    <li><strong>Hora:</strong> ${newAppointment.hora}</li>
                    ${newAppointment.message ? `<li><strong>Mensaje:</strong> ${newAppointment.message}</li>` : ''}
                </ul>
                <p>¡Revisa tu agenda!</p>
                <p>Saludos,<br>NailsCata</p>
            `
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error('Error al enviar correo de notificación:', error.message);
                // NOTA: No enviamos un 500 al cliente si el correo falla, ya que el turno ya se guardó.
                // Es un problema interno que no afecta la acción principal del usuario.
            } else {
                console.log('Correo de notificación enviado:', info.response);
            }
        });

        res.status(201).json({
            message: 'Turno agendado con éxito. Se ha enviado una notificación por correo.',
            appointment: newAppointment
        });

    } catch (err) {
        console.error('Error al agendar turno:', err.message);
        if (err.code === '23505') {
            return res.status(409).json({ error: 'Ya existe un turno agendado para esta fecha y hora.' });
        }
        res.status(500).json({ error: 'Error interno del servidor al agendar turno.' });
    }
});

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor backend de NailsCata corriendo en http://localhost:${PORT}`);
});