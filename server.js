require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: ['https://nailscata1.netlify.app', 'http://localhost:3000']
}));
app.use(express.json());

// Configuración de PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.connect()
    .then(client => {
        console.log('Conectado exitosamente a PostgreSQL');
        client.release();
    })
    .catch(err => {
        console.error('Error al conectar a PostgreSQL:', err.message);
        console.error('Connection string:', process.env.DATABASE_URL);
    });

// Nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const sendConfirmationEmail = async (appointment) => {
    try {
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER, // O al cliente si tenés el mail
            subject: 'Confirmación de Cita con NailsCata',
            html: `
                <h1>¡Hola, ${appointment.nombre}!</h1>
                <p>Tu cita ha sido agendada con éxito.</p>
                <ul>
                    <li><strong>Servicio:</strong> ${appointment.servicio}</li>
                    <li><strong>Fecha:</strong> ${appointment.fecha}</li>
                    <li><strong>Hora:</strong> ${appointment.hora}</li>
                    <li><strong>Nombre:</strong> ${appointment.nombre}</li>
                    <li><strong>Teléfono:</strong> ${appointment.telefono}</li>
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

// Rutas
app.get('/', (req, res) => {
    res.send('¡Hola desde el servidor de NailsCata!');
});

// Citas
app.post('/api/appointments', async (req, res) => {
    const { nombre, telefono, service, date, time } = req.body;
    console.log('[DEBUG] Datos de la cita recibidos:', req.body);
    try {
        const result = await pool.query(
            'INSERT INTO appointments(nombre, telefono, servicio, fecha, hora) VALUES($1, $2, $3, $4, $5) RETURNING *;',
            [nombre, telefono, service, date, time]
        );
        const newAppointment = result.rows[0];
        console.log('[DEBUG] Cita creada:', newAppointment);
        sendConfirmationEmail(newAppointment);
        res.status(201).json(newAppointment);
    } catch (err) {
        console.error('Error al agendar la cita:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al agendar la cita.' });
    }
});

// Horarios
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

// 🔧 NUEVA RUTA agregada — Obtener todos los horarios
app.get('/api/schedules', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM schedules ORDER BY date DESC;');
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error al obtener los horarios:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al obtener los horarios.' });
    }
});

// Obtener todos los turnos
app.get('/api/appointments', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM appointments ORDER BY fecha DESC, hora DESC;');
        res.json(result.rows);
    } catch (err) {
        console.error('Error al obtener los turnos:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al obtener los turnos.' });
    }
});

// Eliminar turno
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

// Eliminar horario por fecha
app.delete('/api/schedules/:date', async (req, res) => {
    const { date } = req.params;
    try {
        const result = await pool.query('DELETE FROM schedules WHERE date = $1 RETURNING *;', [date]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Horario no encontrado para la fecha especificada.' });
        }
        res.status(200).json({ message: 'Horario eliminado con éxito.' });
    } catch (err) {
        console.error('Error al eliminar horario:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al eliminar horario.' });
    }
});

// Obtener horarios disponibles por fecha
app.get('/api/available-times/:date', async (req, res) => {
    const { date } = req.params;
    console.log(`[DEBUG] GET /api/available-times/${date}`);
    try {
        const result = await pool.query('SELECT available_times FROM schedules WHERE date = $1;', [date]);
        if (result.rows.length === 0) {
            return res.status(200).json([]);
        }
        res.status(200).json(result.rows[0].available_times);
    } catch (err) {
        console.error('Error al obtener horarios disponibles:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al obtener horarios disponibles.' });
    }
});

// Middleware 404
app.use((req, res, next) => {
    res.status(404).json({ error: 'Ruta no encontrada.' });
});

// Middleware de errores
app.use((err, req, res, next) => {
    console.error('Error del servidor:', err.stack);
    res.status(500).json({ error: 'Algo salió mal en el servidor.' });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
