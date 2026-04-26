import { Request, Response, NextFunction } from 'express'

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const notFound = (_req: Request, res: Response): void => {
  res.status(404).json({ error: 'Route not found' })
}

export const errorHandler = (
  err: Error, _req: Request, res: Response, _next: NextFunction
): void => {
  console.error(`[ERROR] ${err.name}: ${err.message}`)

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      ...(err.code && { code: err.code })
    })
    return
  }

  if (err.name === 'ValidationError') {
    res.status(400).json({ error: err.message })
    return
  }

  res.status(500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message
  })
}
