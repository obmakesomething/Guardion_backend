import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';
import { healthCheck, isDatabaseAvailable } from './db/pool';
import routes from './routes';

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for SSE
}));

// CORS - use CORS_ORIGINS env var for allowed origins
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, health checks)
    if (!origin) return callback(null, true);
    // Allow all if no origins configured (development)
    if (allowedOrigins.length === 0) return callback(null, true);
    // Check against allowlist
    return callback(null, allowedOrigins.includes(origin));
  },
  credentials: true,
}));

// Request logging
if (config.env !== 'test') {
  app.use(morgan('combined'));
}

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Liveness check - always returns 200 if server is running
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Readiness check - checks database connectivity
app.get('/health/ready', async (_req: Request, res: Response) => {
  const dbConfigured = isDatabaseAvailable();
  const dbHealthy = dbConfigured ? await healthCheck() : false;
  res.status(dbHealthy ? 200 : 503).json({
    status: dbHealthy ? 'ready' : 'not_ready',
    database: {
      configured: dbConfigured,
      connected: dbHealthy,
    },
    timestamp: new Date().toISOString(),
  });
});

// API routes
app.use('/api', routes);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    code: 'NOT_FOUND',
    message: 'Endpoint not found',
  });
});

// Error handler (must be last)
app.use(errorHandler);

// Start server - bind to 0.0.0.0 for Railway/Docker
const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║   🔒 Guardion Backend Server                      ║
║   Emergency Unlock Ops Platform                   ║
║                                                   ║
║   Environment: ${config.env.padEnd(32)}║
║   Listening:   0.0.0.0:${config.port.toString().padEnd(23)}║
║                                                   ║
╚═══════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;
