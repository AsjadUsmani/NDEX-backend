import morgan from 'morgan'
import { Request, Response } from 'express'

const skip = (_req: Request, res: Response) =>
  process.env.NODE_ENV === 'test' || res.statusCode < 400

export const httpLogger = morgan(
  ':method :url :status :response-time ms - :res[content-length]',
  {
    skip: (_req, res) => process.env.NODE_ENV === 'production' && res.statusCode < 400
  }
)

export const errorLogger = morgan(
  ':method :url :status :response-time ms | :req[user-agent]',
  { skip: (_req, res) => res.statusCode < 400 }
)
