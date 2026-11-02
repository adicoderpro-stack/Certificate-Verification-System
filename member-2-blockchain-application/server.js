import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectBlockchain } from './src/config/blockchain.js';
import { initializeDatabase } from './src/config/database.js';
import certificateRoutes from './src/routes/certificateRoutes.js';
import authRoutes from './src/routes/authRoutes.js';
import analyticsRoutes from './src/routes/analyticsRoutes.js';
import auditRoutes from './src/routes/auditRoutes.js';
import { startEventSynchronizer } from './src/services/eventListener.js';

dotenv.config();

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION:', reason);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Configure CORS for Vercel production frontend and local environments
const allowedOrigins = [
    'https://frontend-pi-five-bsw0x51qzu.vercel.app',
    'https://frontend-q822r230r-aryankumarjha2006-3815s-projects.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000'
];

if (process.env.FRONTEND_URL) {
    allowedOrigins.push(process.env.FRONTEND_URL.replace(/\/$/, ''));
}

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
            callback(null, true);
        } else {
            callback(new Error(`CORS policy: Origin ${origin} not allowed`));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Health Check & Root Endpoints (MUST be registered before static and other routes) ---
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        service: 'CredChain Backend',
        network: process.env.RPC_URL && process.env.RPC_URL.includes('sepolia') ? 'Sepolia' : 'Local/Custom',
        timestamp: new Date().toISOString()
    });
});

// Serve static frontend assets
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/certificates', certificateRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/audit', auditRoutes);

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

async function startServer() {
    try {
        console.log('Initializing Database...');
        await initializeDatabase();
    } catch (dbErr) {
        console.error('Database initialization warning:', dbErr);
    }

    // Start HTTP server immediately so cloud platforms (Render, Railway, etc.) pass port checks
    app.listen(PORT, HOST, () => {
        console.log(`Server is running on http://${HOST}:${PORT}`);
    });

    // Asynchronously connect blockchain and start event synchronizer
    (async () => {
        try {
            console.log('Connecting to Blockchain...');
            await connectBlockchain();

            console.log('Starting Event Synchronizer...');
            await startEventSynchronizer();
        } catch (chainErr) {
            console.warn('Blockchain connection/synchronizer warning (server remains running):', chainErr.message || chainErr);
        }
    })();
}

startServer();
