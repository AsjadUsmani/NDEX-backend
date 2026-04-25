import './env'
import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import githubRouter from './routes/github'
import srsRouter from './routes/srs'
import codeRouter from './routes/code'
import settingsRouter from './routes/settings'

const app = express()
const port = Number(process.env.PORT ?? 3001)

app.use(cors({ origin: 'http://localhost:5173', credentials: true }))
app.use(express.json())
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }))
app.use('/api/github', githubRouter)
app.use('/api/srs', srsRouter)
app.use('/api/code', codeRouter)
app.use('/api/settings', settingsRouter)

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'NDEX Backend', version: '1.0.0' })
})

app.listen(port, () => {
  console.log(`NDEX backend running on http://localhost:${port}`)
})

export default app
