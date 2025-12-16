const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs'); 
const app = express();
const path = require('path');
const mysql = require('mysql2');
const multer = require('multer'); 
const xlsx = require('xlsx');
const fs = require('fs');
require('dotenv').config();

// --- CONFIGURACIÓN ---

// Configuración de Multer para subir archivos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
      cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
    }
});
const upload = multer({ storage: storage });

// Crear carpeta uploads si no existe
if (!fs.existsSync('./uploads')){
    fs.mkdirSync('./uploads');
}

// Configuración de la sesión
app.use(session({
  secret: process.env.SESSION_SECRET || 'secreto_temporal',
  resave: false,
  saveUninitialized: false,
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json()); 

app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- BASE DE DATOS ---

const connection = mysql.createConnection({
  host: process.env.DB_HOST,      
  user: process.env.DB_USER,      
  password: process.env.DB_PASSWORD, 
  database: process.env.DB_NAME,
  timezone: 'America/Tijuana'     
});

connection.connect(err => {
  if (err) {
    console.error('❌ Error conectando a MySQL:', err);
    return;
  }
  console.log('✅ Conexión exitosa a la Base de Datos del Banco de Sangre');
});

// --- MIDDLEWARES DE SEGURIDAD ---

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login.html');
  }
  next();
}

function allowRoles(roles = []) {
  return (req, res, next) => {
    if (req.session.user && roles.includes(req.session.user.tipo_usuario)) {
      next();
    } else {
      res.status(403).send(`<h1>Acceso Denegado</h1><p>No tienes permisos para ver esta sección.</p><a href="/">Volver</a>`);
    }
  };
}

// --- RUTAS DE AUTENTICACIÓN ---

app.post('/registro', (req, res) => {
    const { nombre_usuario, password, codigo_acceso } = req.body;
    const query = 'SELECT tipo_usuario FROM codigos_acceso WHERE codigo = ?';
    
    connection.query(query, [codigo_acceso], async (err, results) => {
        if (err || results.length === 0) {
            return res.send('<h1>Código de acceso inválido</h1><a href="/registro.html">Intentar de nuevo</a>');
        }

        const tipo_usuario = results[0].tipo_usuario;
        const hashedPassword = await bcrypt.hash(password, 10);
        const insertUser = 'INSERT INTO usuarios (nombre_usuario, password_hash, tipo_usuario) VALUES (?, ?, ?)';
        
        connection.query(insertUser, [nombre_usuario, hashedPassword, tipo_usuario], (err) => {
            if (err) {
                return res.send('<h1>Error: El usuario ya existe o hubo un problema.</h1><a href="/registro.html">Volver</a>');
            }
            res.redirect('/login.html');
        });
    });
});

app.post('/login', (req, res) => {
    const { nombre_usuario, password } = req.body;
    const query = 'SELECT * FROM usuarios WHERE nombre_usuario = ?';
    
    connection.query(query, [nombre_usuario], async (err, results) => { 
        if (err || results.length === 0) {
            return res.send('<h1>Usuario no encontrado</h1><a href="/login.html">Volver</a>');
        }

        const user = results[0];
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        
        if (!isPasswordValid) {
            return res.send('<h1>Contraseña incorrecta</h1><a href="/login.html">Volver</a>');
        }

        req.session.user = {
            id: user.id,
            nombre_usuario: user.nombre_usuario,
            tipo_usuario: user.tipo_usuario 
        };

        req.session.save(err => {
            if (err) return res.send("Error de sesión");
            res.redirect('/');
        });
    });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login.html');
});

// --- RUTA PRINCIPAL (DASHBOARD) ---
app.get('/', requireLogin, (req, res) => {
    const user = req.session.user;
    
    let menuHtml = `
    <html>
    <head>
        <title>Banco de Sangre - Inicio</title>
        <link rel="stylesheet" href="/styles.css">
        <style>
            body { font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f4; text-align: center; }
            .card { background: white; padding: 20px; margin: 10px auto; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); max-width: 600px; }
            h1 { color: #d9534f; }
            a.btn { display: block; padding: 15px; background: #d9534f; color: white; text-decoration: none; border-radius: 5px; margin: 10px; font-weight: bold; }
            a.btn-sec { background: #5bc0de; }
            a.btn-dark { background: #333; }
            a.btn:hover { opacity: 0.9; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>🩸 Banco de Sangre</h1>
            <p>Bienvenido, <strong>${user.nombre_usuario}</strong> (${user.tipo_usuario})</p>
            <a href="/logout" style="color: red;">Cerrar Sesión</a>
        </div>

        <div class="card">
            <h2>Gestión</h2>
            <a href="/donantes" class="btn">👥 Gestionar Donantes</a>
            <a href="/inventario" class="btn">🏥 Ver Inventario de Sangre</a>
        </div>
    `;

    if (['admin', 'medico'].includes(user.tipo_usuario)) {
        menuHtml += `
        <div class="card">
            <h2>Operaciones</h2>
            <a href="/registrar-donacion-form" class="btn btn-sec">➕ Registrar Nueva Donación (Entrada)</a>
        </div>
        `;
    }

    if (user.tipo_usuario === 'admin') {
        menuHtml += `
        <div class="card" style="border: 2px solid #333;">
            <h2>Zona Administrativa</h2>
            <a href="/gestionar-usuarios" class="btn btn-dark">🔐 Gestionar Usuarios del Sistema</a>
        </div>
        `;
    }

    menuHtml += `
        <div class="card">
            <h2>Reportes</h2>
            <a href="/descargar-donantes" class="btn btn-sec">📥 Descargar Lista (Excel)</a>
        </div>
    </body>
    </html>
    `;

    res.send(menuHtml);
});

// --- GESTIÓN DE DONANTES (CON 2 DOCUMENTOS) ---

app.get('/donantes', requireLogin, (req, res) => {
    connection.query('SELECT * FROM donantes ORDER BY id DESC', (err, results) => {
        if (err) return res.send('Error al obtener donantes');

        let html = `
        <html>
        <head><title>Donantes</title><link rel="stylesheet" href="/styles.css"></head>
        <body>
            <div style="padding: 20px;">
                <h1>Lista de Donantes</h1>
                <input type="text" id="buscador" placeholder="Buscar por nombre..." onkeyup="buscarDonante()" style="padding: 10px; width: 300px;">
                <a href="/nuevo-donante-form" class="btn-add" style="margin-left: 10px;">➕ Nuevo Donante</a>
                <a href="/" class="btn-back" style="margin-left: 10px;">🏠 Volver</a>
                <br><br>
                <table border="1" cellpadding="10" style="border-collapse: collapse; width: 100%; background: white;">
                    <thead>
                        <tr style="background-color: #d9534f; color: white;">
                            <th>ID</th><th>Nombre</th><th>Tipo Sangre</th><th>Edad</th><th>Teléfono</th><th>Documentos</th><th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="tabla-donantes">
        `;

        results.forEach(d => {
            html += `
                <tr>
                    <td>${d.id}</td>
                    <td>${d.nombre_completo}</td>
                    <td><b>${d.tipo_sangre}</b></td>
                    <td>${d.edad}</td>
                    <td>${d.telefono}</td>
                    <td>
                        ${d.documento_pdf ? `<a href="/uploads/${d.documento_pdf}" target="_blank" style="color: blue; display:block;">📄 Ver ID</a>` : '<span style="color:gray; display:block;">Sin ID</span>'}
                        ${d.documento_clinico ? `<a href="/uploads/${d.documento_clinico}" target="_blank" style="color: green; font-weight:bold; display:block;">📋 Ver Historial</a>` : '<span style="color:gray; display:block;">Sin Historial</span>'}
                    </td>
                    <td>
                        <a href="/editar-donante/${d.id}">✏️ Editar</a>
                        ${req.session.user.tipo_usuario === 'admin' ? 
                            `<form action="/eliminar-donante" method="POST" style="display:inline;">
                                <input type="hidden" name="id" value="${d.id}">
                                <button type="submit" onclick="return confirm('¿Seguro?')">🗑️</button>
                             </form>` : ''}
                    </td>
                </tr>`;
        });

        html += `</tbody></table></div>
        <script>
            function buscarDonante() {
                const texto = document.getElementById('buscador').value;
                fetch('/buscar-donante-live?q=' + texto)
                    .then(response => response.json())
                    .then(data => {
                        const tbody = document.getElementById('tabla-donantes');
                        tbody.innerHTML = '';
                        data.forEach(d => {
                            let linkPdf = d.documento_pdf ? '<a href="/uploads/'+d.documento_pdf+'" target="_blank" style="color:blue;">📄 Ver ID</a>' : '-';
                            let linkClinico = d.documento_clinico ? '<a href="/uploads/'+d.documento_clinico+'" target="_blank" style="color:green;">📋 Ver Historial</a>' : '-';
                            
                            tbody.innerHTML += \`
                                <tr>
                                    <td>\${d.id}</td>
                                    <td>\${d.nombre_completo}</td>
                                    <td><b>\${d.tipo_sangre}</b></td>
                                    <td>\${d.edad}</td>
                                    <td>\${d.telefono}</td>
                                    <td>\${linkPdf} <br> \${linkClinico}</td>
                                    <td><a href="/editar-donante/\${d.id}">✏️ Editar</a></td>
                                </tr>\`;
                        });
                    });
            }
        </script></body></html>`;
        res.send(html);
    });
});

app.get('/buscar-donante-live', requireLogin, (req, res) => {
    const q = req.query.q;
    const query = "SELECT * FROM donantes WHERE nombre_completo LIKE ? LIMIT 10";
    connection.query(query, [`%${q}%`], (err, results) => {
        if(err) return res.status(500).json([]);
        res.json(results);
    });
});

// FORMULARIO DE NUEVO DONANTE CON 2 ARCHIVOS
app.get('/nuevo-donante-form', requireLogin, (req, res) => {
    res.send(`
        <html><head><title>Nuevo</title><link rel="stylesheet" href="/styles.css"></head><body>
            <div class="login-container" style="width: 450px; margin: 50px auto;">
                <h1>Nuevo Donante</h1>
                <form action="/crear-donante" method="POST" enctype="multipart/form-data">
                    <label>Nombre Completo:</label><input type="text" name="nombre" required><br><br>
                    <label>Edad:</label><input type="number" name="edad" required><br><br>
                    <label>Peso (Kg):</label><input type="number" step="0.1" name="peso" required><br><br>
                    <label>Tipo de Sangre:</label>
                    <select name="tipo_sangre">
                        <option value="A+">A+</option><option value="A-">A-</option><option value="B+">B+</option>
                        <option value="B-">B-</option><option value="AB+">AB+</option><option value="AB-">AB-</option>
                        <option value="O+">O+</option><option value="O-">O-</option>
                    </select><br><br>
                    <label>Teléfono:</label><input type="text" name="telefono"><br><br>
                    
                    <hr>
                    <label style="color:#d9534f; font-weight:bold;">1. Identificación Oficial (Obligatorio):</label><br>
                    <small>INE, Pasaporte o Licencia.</small><br>
                    <input type="file" name="archivo_adjunto"><br><br>

                    <label style="color:#28a745; font-weight:bold;">2. Historial Clínico (Opcional):</label><br>
                    <small>PDF con antecedentes de enfermedades.</small><br>
                    <input type="file" name="archivo_clinico"><br><br>
                    <hr>

                    <button type="submit">Guardar Donante</button>
                </form>
                <a href="/donantes">Cancelar</a>
            </div>
        </body></html>
    `);
});

// PROCESAR NUEVO DONANTE (Recibe 2 archivos)
app.post('/crear-donante', requireLogin, upload.fields([{ name: 'archivo_adjunto' }, { name: 'archivo_clinico' }]), (req, res) => {
    const { nombre, edad, peso, tipo_sangre, telefono } = req.body;
    
    // Obtenemos los nombres de los archivos si existen
    const docId = req.files['archivo_adjunto'] ? req.files['archivo_adjunto'][0].filename : null;
    const docClinico = req.files['archivo_clinico'] ? req.files['archivo_clinico'][0].filename : null;

    connection.query('INSERT INTO donantes (nombre_completo, edad, peso_kg, tipo_sangre, telefono, documento_pdf, documento_clinico) VALUES (?, ?, ?, ?, ?, ?, ?)', 
    [nombre, edad, peso, tipo_sangre, telefono, docId, docClinico], (err) => {
        if (err) return res.send('Error: ' + err.message);
        res.redirect('/donantes');
    });
});

app.post('/eliminar-donante', requireLogin, allowRoles(['admin']), (req, res) => {
    connection.query('DELETE FROM donantes WHERE id = ?', [req.body.id], (err) => {
        res.redirect('/donantes');
    });
});

// --- RUTAS DE EDICIÓN ---

app.get('/editar-donante/:id', requireLogin, (req, res) => {
    const id = req.params.id;
    connection.query('SELECT * FROM donantes WHERE id = ?', [id], (err, results) => {
        if (err || results.length === 0) return res.send("Donante no encontrado");
        const d = results[0];
        const isSelected = (val) => d.tipo_sangre === val ? 'selected' : '';

        res.send(`
            <html><head><title>Editar</title><link rel="stylesheet" href="/styles.css"></head><body>
                <div class="login-container" style="width: 400px; margin: 50px auto;">
                    <h1>✏️ Editar Donante</h1>
                    <form action="/actualizar-donante" method="POST">
                        <input type="hidden" name="id" value="${d.id}">
                        <label>Nombre:</label><input type="text" name="nombre" value="${d.nombre_completo}" required><br><br>
                        <label>Edad:</label><input type="number" name="edad" value="${d.edad}" required><br><br>
                        <label>Peso:</label><input type="number" step="0.1" name="peso" value="${d.peso_kg}" required><br><br>
                        <label>Sangre:</label>
                        <select name="tipo_sangre">
                            <option value="A+" ${isSelected('A+')}>A+</option><option value="A-" ${isSelected('A-')}>A-</option>
                            <option value="B+" ${isSelected('B+')}>B+</option><option value="B-" ${isSelected('B-')}>B-</option>
                            <option value="AB+" ${isSelected('AB+')}>AB+</option><option value="AB-" ${isSelected('AB-')}>AB-</option>
                            <option value="O+" ${isSelected('O+')}>O+</option><option value="O-" ${isSelected('O-')}>O-</option>
                        </select><br><br>
                        <label>Teléfono:</label><input type="text" name="telefono" value="${d.telefono}"><br><br>
                        <button type="submit">Actualizar</button>
                    </form>
                    <a href="/donantes">Cancelar</a>
                </div>
            </body></html>
        `);
    });
});

app.post('/actualizar-donante', requireLogin, (req, res) => {
    const { id, nombre, edad, peso, tipo_sangre, telefono } = req.body;
    connection.query('UPDATE donantes SET nombre_completo=?, edad=?, peso_kg=?, tipo_sangre=?, telefono=? WHERE id=?', 
    [nombre, edad, peso, tipo_sangre, telefono, id], (err) => {
        if (err) return res.send('Error: ' + err.message);
        res.redirect('/donantes');
    });
});

// --- TRANSACCIÓN: REGISTRAR DONACIÓN (ENTRADA) ---

app.get('/registrar-donacion-form', requireLogin, allowRoles(['admin', 'medico']), (req, res) => {
    connection.query('SELECT id, nombre_completo, tipo_sangre FROM donantes', (err, donantes) => {
        let options = donantes.map(d => `<option value="${d.id}" data-tipo="${d.tipo_sangre}">${d.nombre_completo} (${d.tipo_sangre})</option>`).join('');
        
        res.send(`
            <html><head><title>Donar</title><link rel="stylesheet" href="/styles.css"></head><body>
                <div class="login-container" style="width: 400px; margin: 50px auto;">
                    <h1>🩸 Nueva Donación</h1>
                    <form action="/procesar-donacion" method="POST">
                        <label>Donante:</label><br>
                        <select name="id_donante" id="selectDonante" onchange="actualizarTipo()" style="width:100%; padding:10px;">${options}</select><br><br>
                        <input type="hidden" name="tipo_sangre" id="inputTipo" value="${donantes[0]?.tipo_sangre || ''}">
                        <label>Volumen (ml):</label><br><input type="number" name="volumen" value="450" required><br><br>
                        <label>Caducidad:</label><br><input type="date" name="caducidad" required><br><br>
                        <button type="submit">REGISTRAR ENTRADA (+1)</button>
                    </form>
                    <a href="/">Cancelar</a>
                </div>
                <script>
                    function actualizarTipo() {
                        const select = document.getElementById('selectDonante');
                        const tipo = select.options[select.selectedIndex].getAttribute('data-tipo');
                        document.getElementById('inputTipo').value = tipo;
                    }
                </script>
            </body></html>
        `);
    });
});

app.post('/procesar-donacion', requireLogin, allowRoles(['admin', 'medico']), (req, res) => {
    const { id_donante, tipo_sangre, volumen, caducidad } = req.body;
    connection.beginTransaction(err => {
        if (err) return res.send("Error iniciando transacción");
        
        connection.query('INSERT INTO donaciones (id_donante, volumen_ml, fecha_caducidad) VALUES (?, ?, ?)', 
        [id_donante, volumen, caducidad], (err) => {
            if (err) return connection.rollback(() => res.send("Error registro donación"));
            
            // ACTUALIZAR INVENTARIO (SUMAR)
            connection.query('UPDATE inventario SET cantidad_unidades = cantidad_unidades + 1 WHERE tipo_sangre = ?', 
            [tipo_sangre], (err) => {
                if (err) return connection.rollback(() => res.send("Error inventario"));
                
                connection.commit(err => {
                    if (err) return connection.rollback(() => res.send("Error commit"));
                    res.redirect('/inventario');
                });
            });
        });
    });
});

// --- INVENTARIO CON ALERTAS (Lógica Nueva) ---

app.get('/inventario', requireLogin, (req, res) => {
    connection.query('SELECT * FROM inventario', (err, stock) => {
        connection.query('SELECT * FROM vista_stock_critico', (err, criticos) => {
            
            // BUSCAR DONACIONES POR VENCER (Próximos 7 días) O VENCIDAS
            const queryVencimiento = `
                SELECT d.id, d.fecha_caducidad, d.tipo_sangre, don.nombre_completo 
                FROM donaciones d
                JOIN donantes don ON d.id_donante = don.id
                WHERE d.fecha_caducidad <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
                ORDER BY d.fecha_caducidad ASC
            `;

            connection.query(queryVencimiento, (err, vencimientos) => {
                let alertasEscasez = '';
                if(criticos && criticos.length > 0) {
                    alertasEscasez = `<div style="background: #ffcccb; padding: 10px; border: 1px solid red; color: red; margin-bottom: 20px;">
                        <h3>⚠️ ALERTA DE ESCASEZ</h3>
                        <p>Reponer urgente: ${criticos.map(c => `<b>${c.tipo_sangre}</b>`).join(', ')}</p>
                    </div>`;
                }

                let alertasCaducidad = '';
                if(vencimientos && vencimientos.length > 0) {
                    let itemsHtml = vencimientos.map(v => {
                        const hoy = new Date();
                        const fechaVenc = new Date(v.fecha_caducidad);
                        // Si fecha < hoy, es ROJO. Si no, es AMARILLO.
                        const estilo = fechaVenc < hoy ? 'background: #ffe6e6; border: 2px solid red;' : 'background: #fff3cd; border: 2px solid orange;';
                        const textoEstado = fechaVenc < hoy ? '🔴 ¡YA VENCIÓ! DESECHAR' : '🟠 Vence pronto';

                        return `
                        <div style="${estilo} padding: 10px; margin: 5px; border-radius: 5px; display: flex; justify-content: space-between; align-items: center; text-align: left;">
                            <div>
                                <strong>${textoEstado}</strong><br>
                                Sangre: <b>${v.tipo_sangre}</b> | Fecha: ${v.fecha_caducidad.toISOString().split('T')[0]}<br>
                                Donante: ${v.nombre_completo}
                            </div>
                            <form action="/desechar-caducada" method="POST" style="margin:0;">
                                <input type="hidden" name="id_donacion" value="${v.id}">
                                <input type="hidden" name="tipo_sangre" value="${v.tipo_sangre}">
                                <button type="submit" style="background: #d9534f; color: white; border: none; padding: 8px; cursor: pointer;">🗑️ Desechar</button>
                            </form>
                        </div>`;
                    }).join('');

                    alertasCaducidad = `<div style="margin-bottom: 20px;">
                        <h3 style="color: #d9534f;">⚠️ Alertas de Caducidad</h3>
                        ${itemsHtml}
                    </div>`;
                }

                let html = `
                <html><head><title>Inventario</title><link rel="stylesheet" href="/styles.css"></head><body>
                    <div style="padding:20px; text-align:center;">
                        <h1>🏥 Gestión de Inventario</h1>
                        <p>Control de Entradas (Donaciones) y Salidas (Transfusiones)</p>
                        ${alertasEscasez}
                        ${alertasCaducidad}
                        
                        <table border="1" cellpadding="10" style="margin: auto; width: 60%; background: white;">
                            <tr style="background: #d9534f; color: white;">
                                <th>Tipo Sangre</th>
                                <th>Stock Actual</th>
                                <th>Registrar Salida (Uso)</th>
                            </tr>
                `;
                
                stock.forEach(s => {
                    html += `
                    <tr>
                        <td><h2>${s.tipo_sangre}</h2></td>
                        <td><h2 style="color: ${s.cantidad_unidades < 5 ? 'red' : 'green'}">${s.cantidad_unidades}</h2></td>
                        <td>
                            ${s.cantidad_unidades > 0 ? 
                                `<form action="/salida-inventario" method="POST" style="margin:0;">
                                    <input type="hidden" name="tipo" value="${s.tipo_sangre}">
                                    <button type="submit" style="background: #333; cursor:pointer; color: white;" onclick="return confirm('¿Confirmar uso de 1 unidad de ${s.tipo_sangre} para transfusión?')">
                                        ➖ Despachar 1 Unidad
                                    </button>
                                </form>` 
                            : '<span style="color:gray">Sin stock</span>'}
                        </td>
                    </tr>`;
                });

                html += `
                        </table>
                        <br>
                        <div style="margin-top:20px;">
                            <a href="/registrar-donacion-form" class="btn-add">➕ Registrar Entrada (Donación)</a>
                        </div>
                        <br>
                        <a href="/" class="btn-back">Volver al Inicio</a>
                    </div>
                </body></html>`;
                res.send(html);
            });
        });
    });
});

// NUEVA RUTA: DESECHAR CADUCADA (Elimina y Resta)
app.post('/desechar-caducada', requireLogin, allowRoles(['admin', 'medico']), (req, res) => {
    const { id_donacion, tipo_sangre } = req.body;
    connection.beginTransaction(err => {
        if(err) return res.send("Error");
        
        // 1. Borrar de donaciones
        connection.query('DELETE FROM donaciones WHERE id = ?', [id_donacion], (err) => {
            if(err) return connection.rollback(() => res.send("Error Delete"));
            
            // 2. Restar del inventario
            connection.query('UPDATE inventario SET cantidad_unidades = cantidad_unidades - 1 WHERE tipo_sangre = ? AND cantidad_unidades > 0', 
            [tipo_sangre], (err) => {
                if(err) return connection.rollback(() => res.send("Error Update"));
                connection.commit(err => res.redirect('/inventario'));
            });
        });
    });
});

// RUTA: SALIDA NORMAL
app.post('/salida-inventario', requireLogin, allowRoles(['admin', 'medico']), (req, res) => {
    const tipoSangre = req.body.tipo;
    const query = 'UPDATE inventario SET cantidad_unidades = cantidad_unidades - 1 WHERE tipo_sangre = ? AND cantidad_unidades > 0';

    connection.query(query, [tipoSangre], (err, result) => {
        if (err) return res.send("Error al actualizar inventario");
        res.redirect('/inventario');
    });
});

// --- GESTIÓN DE USUARIOS (SOLO ADMIN) ---

app.get('/gestionar-usuarios', requireLogin, allowRoles(['admin']), (req, res) => {
    const query = 'SELECT id, nombre_usuario, tipo_usuario FROM usuarios';
    
    connection.query(query, (err, users) => {
        if (err) return res.send("Error al obtener usuarios");
        
        let html = `
        <html><head><title>Admin Usuarios</title><link rel="stylesheet" href="/styles.css"></head>
        <body>
            <div style="padding: 20px;">
                <h1>🔐 Panel de Administración: Empleados</h1>
                <p>Gestionar acceso del personal médico y administrativo.</p>
                
                <table border="1" cellpadding="10" style="width: 80%; margin:auto; background:white;">
                    <tr style="background: #333; color: white;">
                        <th>ID</th><th>Usuario</th><th>Rol</th><th>Acción</th>
                    </tr>
        `;
        
        users.forEach(u => {
            html += `
                <tr>
                    <td>${u.id}</td>
                    <td>${u.nombre_usuario}</td>
                    <td>${u.tipo_usuario.toUpperCase()}</td>
                    <td>
                        ${u.id !== req.session.user.id ? 
                            `<form action="/eliminar-usuario" method="POST" style="margin:0;">
                                <input type="hidden" name="id" value="${u.id}">
                                <button type="submit" style="background: red; font-size: 12px;" onclick="return confirm('¿Despedir a este usuario?')">ELIMINAR</button>
                             </form>` 
                        : '<span style="color:gray;">(Tú)</span>'}
                    </td>
                </tr>
            `;
        });
        
        html += `</table><br><a href="/" class="btn-back">Volver al Inicio</a></div></body></html>`;
        res.send(html);
    });
});

app.post('/eliminar-usuario', requireLogin, allowRoles(['admin']), (req, res) => {
    const idBorrar = req.body.id;
    if (idBorrar == req.session.user.id) {
        return res.send("No puedes eliminar tu propia cuenta.");
    }
    
    connection.query('DELETE FROM usuarios WHERE id = ?', [idBorrar], (err) => {
        if (err) return res.send("Error al eliminar");
        res.redirect('/gestionar-usuarios');
    });
});

// --- EXCEL ---

app.get('/descargar-donantes', requireLogin, (req, res) => {
    connection.query('SELECT * FROM donantes', (err, data) => {
        if (err) return res.send("Error SQL");
        const worksheet = xlsx.utils.json_to_sheet(data);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, "Donantes");
        const filePath = path.join(__dirname, 'uploads', 'reporte_donantes.xlsx');
        xlsx.writeFile(workbook, filePath);
        res.download(filePath);
    });
});

// Iniciar servidor
app.listen(3000, () => {
    console.log('🚀 Servidor Banco de Sangre corriendo en http://localhost:3000');
});