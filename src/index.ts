import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';
import { healthCheck } from './db/pool';
import routes from './routes';

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for SSE
}));

// CORS
app.use(cors({
  origin: config.env === 'production'
    ? ['https://yourproductiondomain.com']
    : true, // Allow all in development
  credentials: true,
}));

// Request logging
if (config.env !== 'test') {
  app.use(morgan('combined'));
}

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', async (_req: Request, res: Response) => {
  const dbHealthy = await healthCheck();
  res.status(dbHealthy ? 200 : 503).json({
    status: dbHealthy ? 'healthy' : 'unhealthy',
    database: dbHealthy ? 'connected' : 'disconnected',
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

// Start server
const server = app.listen(config.port, () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║   🔒 Guardion Backend Server                      ║
║   Emergency Unlock Ops Platform                   ║
║                                                   ║
║   Environment: ${config.env.padEnd(32)}║
║   Port: ${config.port.toString().padEnd(39)}║
║   API Base: http://localhost:${config.port}/api${' '.repeat(14)}║
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
