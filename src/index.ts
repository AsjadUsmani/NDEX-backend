import './env'
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import cookieParser from 'cookie-parser'
import { securityHeaders } from './middleware/security'
import { globalLimiter } from './middleware/rateLimit'
import { httpLogger, errorLogger } from './middleware/logger'
import { notFound, errorHandler } from './middleware/errorHandler'

import authRouter from './routes/auth'
import githubRouter from './routes/github'
import srsRouter from './routes/srs'
import codeRouter from './routes/code'
import settingsRouter from './routes/settings'
import preferencesRouter from './routes/preferences'
import reposRouter from './routes/repos'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

// Security
app.use(securityHeaders)
app.set('trust proxy', 1)

// Logging
app.use(httpLogger)
app.use(errorLogger)

// Parsing
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}))
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true, limit: '2mb' }))
app.use(cookieParser())

// Rate limiting
app.use(globalLimiter)

// Health check (no auth)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'NDEX API', version: '1.0.0',
             timestamp: new Date().toISOString() })
})

// Routes
app.use('/api/auth',        authRouter)
app.use('/api/github',      githubRouter)
app.use('/api/srs',         srsRouter)
app.use('/api/code',        codeRouter)
app.use('/api/settings',    settingsRouter)
app.use('/api/preferences', preferencesRouter)
app.use('/api/repos',       reposRouter)

// Error handling — must be last
app.use(notFound)
app.use(errorHandler)

app.listen(PORT, () => {
  console.log(`NDEX backend → http://localhost:${PORT}`)
})

export default app
