const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const https = require('https'); // RESTORED
const path = require('path');
const fs = require('fs'); // RESTORED
const winston = require('winston');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Logger Setup
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'combined.log' }),
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.Console({ format: winston.format.simple() })
    ],
});

// 2. SSL Credentials - RESTORED
let credentials = {};
try {
    const privateKey = fs.readFileSync(path.join(__dirname, 'server.key'), 'utf8');
    const certificate = fs.readFileSync(path.join(__dirname, 'server.cert'), 'utf8');
    credentials = { key: privateKey, cert: certificate };
    logger.info("SSL Certificates loaded successfully.");
} catch (err) {
    logger.error("SSL Certificate error: Make sure server.key and server.cert exist.");
    process.exit(1);
}

app.use(cors());
app.use(express.json());

// 3. Database Initialization (Improved)
const dbPath = path.join(__dirname, 'checkers.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        logger.error(`Database connection failed: ${err.message}`);
    } else {
        logger.info('Connected to SQLite database');
        // Use serialize to ensure table exists before any queries run
        db.serialize(() => {
            db.run(`
                CREATE TABLE IF NOT EXISTS lobbies (
                    lobby_id TEXT PRIMARY KEY,
                    host_name TEXT NOT NULL,
                    guest_name TEXT,
                    game_state TEXT NOT NULL,
                    current_turn TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )
            `, (err) => {
                if (err) logger.error("Table creation failed:", err);
            });
        });
    }
});

// 4. API Routes (Added basic validation example)
app.post('/api/lobbies', (req, res) => {
    const { lobby_id, player_name, game_state, current_turn } = req.body;
    
    // Basic Validation
    if (!lobby_id || !player_name || !game_state) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    const now = Date.now();
    db.run(
        `INSERT INTO lobbies (lobby_id, host_name, game_state, current_turn, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [lobby_id, player_name, game_state, current_turn || 'red', 'waiting', now, now],
        (err) => {
            if (err) {
                // Check for duplicate ID
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(409).json({ error: 'Lobby ID already exists' });
                }
                return res.status(500).json({ error: err.message });
            }
            res.status(201).json({ lobby_id, status: 'waiting' });
        }
    );
});

// Add this with your other routes (after the POST /api/lobbies route)
app.get('/api/lobbies', (req, res) => {
    db.all('SELECT * FROM lobbies WHERE status = "waiting" ORDER BY created_at DESC', [], (err, rows) => {
        if (err) {
            logger.error(`Failed to fetch lobbies: ${err.message}`);
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});


app.post('/api/lobbies/:lobbyId/join', (req, res) => {
    const lobbyId = decodeURIComponent(req.params.lobbyId);
    db.run(
        'UPDATE lobbies SET status = "playing", guest_name = ?, updated_at = ? WHERE lobby_id = ? AND guest_name IS NULL',
        [req.body.player_name, Date.now(), lobbyId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Lobby full or not found' });
            res.json({ success: true });
        }
    );
});

app.put('/api/lobbies/:lobbyId', (req, res) => {
    const lobbyId = decodeURIComponent(req.params.lobbyId);
    db.run(
        'UPDATE lobbies SET game_state = ?, current_turn = ?, updated_at = ? WHERE lobby_id = ?',
        [req.body.game_state, req.body.current_turn, Date.now(), lobbyId],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

app.get('/api/lobbies/:lobbyId', (req, res) => {
    const lobbyId = decodeURIComponent(req.params.lobbyId);
    db.get('SELECT * FROM lobbies WHERE lobby_id = ?', [lobbyId], (err, row) => {
        if (err) {
            logger.error(`Failed to fetch lobby: ${err.message}`);
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            return res.status(404).json({ error: 'Lobby not found' });
        }
        res.json(row);
    });
});

app.delete('/api/lobbies/:lobbyId', (req, res) => {
    db.run('DELETE FROM lobbies WHERE lobby_id = ?', [decodeURIComponent(req.params.lobbyId)], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// 5. Start HTTPS Server - RESTORED
const httpsServer = https.createServer(credentials, app);
httpsServer.listen(PORT, () => {
    logger.info(`HTTPS Server running on port ${PORT}`);
});

// 6. Cleanup
setInterval(() => {
    db.run('DELETE FROM lobbies WHERE updated_at < ?', [Date.now() - (60 * 60 * 1000)]);
}, 60 * 60 * 1000);
