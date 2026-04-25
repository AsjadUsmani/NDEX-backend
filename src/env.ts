import path from 'path'
import dotenv from 'dotenv'

// Always resolve the backend-local .env whether running via ts-node or compiled dist.
dotenv.config({ path: path.resolve(__dirname, '../.env') })
