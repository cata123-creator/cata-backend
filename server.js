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
        const dayOfWeek = new Date(date).getDay(); // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado

        // Obtener los horarios base para el día de la semana desde la base de datos
        const scheduleResult = await pool.query(
            'SELECT available_times FROM schedules WHERE day_of_week_num = $1;',
            [dayOfWeek]
        );

        let availableTimes = [];
        if (scheduleResult.rows.length > 0) {
            availableTimes = scheduleResult.rows[0].available_times;
        } else {
            // Si no hay configuración en la DB para este día, el día se considera sin horarios.
            console.log(`No schedule found in DB for day_of_week_num: ${dayOfWeek}`);
        }

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

// =========================================================
// RUTAS PARA LA GESTIÓN DE HORARIOS DISPONIBLES
// =========================================================

// POST /api/schedules - Crear o actualizar un horario para un día específico
// Body: { day_of_week_num: 0-6, day_name: 'Monday', available_times: ["09:00", "10:00"] }
app.post('/api/schedules', async (req, res) => {
    const { day_of_week_num, day_name, available_times } = req.body;

    if (day_of_week_num === undefined || !day_name || !Array.isArray(available_times)) {
        return res.status(400).json({ error: 'Faltan campos obligatorios: day_of_week_num, day_name, available_times (array).' });
    }

    try {
        // Usamos INSERT ... ON CONFLICT para insertar si no existe, o actualizar si ya existe
        const query = `
            INSERT INTO schedules (day_of_week_num, day_name, available_times)
            VALUES ($1, $2, $3)
            ON CONFLICT (day_of_week_num) DO UPDATE SET
                day_name = EXCLUDED.day_name,
                available_times = EXCLUDED.available_times
            RETURNING *;
        `;
        const values = [day_of_week_num, day_name, available_times];
        const result = await pool.query(query, values);
        res.status(200).json({ message: 'Horario guardado/actualizado con éxito.', schedule: result.rows[0] });
    } catch (err) {
        console.error('Error al guardar/actualizar horario:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al guardar/actualizar horario.' });
    }
});

// GET /api/schedules - Obtener todos los horarios configurados
app.get('/api/schedules', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM schedules ORDER BY day_of_week_num;');
        res.status(200).json({ schedules: result.rows });
    } catch (err) {
        console.error('Error al obtener horarios configurados:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al obtener horarios configurados.' });
    }
});

// GET /api/schedules/:dayOfWeekNum - Obtener horario de un día específico
app.get('/api/schedules/:dayOfWeekNum', async (req, res) => {
    const { dayOfWeekNum } = req.params;
    try {
        const result = await pool.query('SELECT * FROM schedules WHERE day_of_week_num = $1;', [dayOfWeekNum]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Horario para el día no encontrado.' });
        }
        res.status(200).json({ schedule: result.rows[0] });
    } catch (err) {
        console.error('Error al obtener horario por día:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al obtener horario por día.' });
    }
});

// DELETE /api/schedules/:dayOfWeekNum - Eliminar el horario configurado para un día
app.delete('/api/schedules/:dayOfWeekNum', async (req, res) => {
    const { dayOfWeekNum } = req.params;
    try {
        const result = await pool.query('DELETE FROM schedules WHERE day_of_week_num = $1 RETURNING *;', [dayOfWeekNum]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Horario para el día no encontrado.' });
        }
        res.status(200).json({ message: 'Horario del día eliminado con éxito.', deletedSchedule: result.rows[0] });
    } catch (err) {
        console.error('Error al eliminar horario:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al eliminar horario.' });
    }
});

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor backend de NailsCata corriendo en http://localhost:${PORT}`);
});