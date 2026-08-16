import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import { env } from './config/environment.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { router } from './routes/index.js';

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()), credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', router);

  app.use(notFoundHandler);

  // Turn schema failures into 400s before the generic handler sees them.
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: 'Invalid request',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }
    next(err);
  });

  app.use(errorHandler);

  return app;
}
