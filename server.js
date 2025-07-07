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
  origin: ['https://nailscata1.netlify.app', 'http://localhost:3000']  // podés agregar más si querés
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
        // Asegúrate de seleccionar también el 'id' para poder eliminar turnos por ID
        const result = await pool.query('SELECT id, fecha, hora, servicio, nombre, telefono, message FROM turnos_nailscata ORDER BY fecha, hora');
        res.json({ reservedSlots: result.rows });
    } catch (err) {
        console.error('Error al obtener turnos:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al obtener turnos' });
    }
});

// POST /api/appointments - Agendar un nuevo turno
app.post('/api/appointments', async (req, res) => {
    const { fecha, hora, servicio, nombre, telefono, message } = req.body;

    // Validar datos de entrada (simple)
    if (!fecha || !hora || !servicio || !nombre || !telefono) {
        return res.status(400).json({ error: 'Faltan campos obligatorios para agendar el turno.' });
    }

    try {
        const query = `
            INSERT INTO turnos_nailscata (fecha, hora, servicio, nombre, telefono, message)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *;
        `;
        const values = [fecha, hora, servicio, nombre, telefono, message || null];

        const result = await pool.query(query, values);
        const newAppointment = result.rows[0]; // El turno recién agendado

        // Enviar notificación por correo electrónico
        const mailOptions = {
            from: process.env.EMAIL_USER, // Desde tu Gmail
            to: process.env.EMAIL_USER,   // A tu mismo Gmail (o a otro correo si quieres)
            subject: 'Nuevo Turno Agendado en NailsCata',
            html: `
                <p>¡Hola!</p>
                <p>Se ha agendado un nuevo turno en NailsCata:</p>
                <ul>
                    <li><strong>Nombre:</strong> ${newAppointment.nombre}</li>
                    <li><strong>Teléfono:</strong> ${newAppointment.telefono}</li>
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
        if (err.code === '23505') { // Código para violación de restricción de unicidad (ej. si intentas agendar 2 veces la misma fecha/hora)
            return res.status(409).json({ error: 'Ya existe un turno agendado para esta fecha y hora.' });
        }
        res.status(500).json({ error: 'Error interno del servidor al agendar turno.' });
    }
});

// GET /api/available-times?date=YYYY-MM-DD - Obtener horarios disponibles para una fecha específica
app.get('/api/available-times', async (req, res) => {
    const { date } = req.query; // Obtener la fecha de los parámetros de la URL

    if (!date) {
        return res.status(400).json({ error: 'Falta el parámetro de fecha.' });
    }

    try {
        // Lógica para determinar los horarios base según el día de la semana
        let availableTimes = [];
        const dayOfWeek = new Date(date).getDay(); // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado

        // Define tus horarios:
        if (dayOfWeek >= 1 && dayOfWeek <= 5) { // Lunes a Viernes
            availableTimes = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
        } else if (dayOfWeek === 6) { // Sábado
            availableTimes = ['09:00', '10:00', '11:00', '12:00', '13:00'];
        }
        // Si trabajas los domingos, puedes añadir un 'else if (dayOfWeek === 0)' con sus propios horarios.
        // Si no se trabaja un día, simplemente no se añade nada a 'availableTimes' para ese día.

        // Obtener los horarios ya reservados para esta fecha desde la base de datos
        const bookedTimesResult = await pool.query(
            'SELECT hora FROM turnos_nailscata WHERE fecha = $1;',
            [date]
        );
        const bookedTimes = bookedTimesResult.rows.map(row => row.hora);

        // Filtrar los horarios base para quitar los que ya están reservados
        const filteredTimes = availableTimes.filter(time => !bookedTimes.includes(time));

        res.status(200).json({ availableTimes: filteredTimes });

    } catch (err) {
        console.error('Error al obtener horarios disponibles:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al obtener horarios disponibles.' });
    }
});

// DELETE /api/appointments/:id - Eliminar un turno por su ID
app.delete('/api/appointments/:id', async (req, res) => {
    const { id } = req.params; // Obtener el ID del turno desde la URL

    try {
        const result = await pool.query('DELETE FROM turnos_nailscata WHERE id = $1 RETURNING *;', [id]);

        if (result.rowCount === 0) {
            // Si no se encontró ningún turno con ese ID
            return res.status(404).json({ error: 'Turno no encontrado.' });
        }

        res.status(200).json({ message: 'Turno eliminado con éxito.', deletedAppointment: result.rows[0] });

    } catch (err) {
        console.error('Error al eliminar turno:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al eliminar turno.' });
    }
});

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor backend de NailsCata corriendo en http://localhost:${PORT}`);
});