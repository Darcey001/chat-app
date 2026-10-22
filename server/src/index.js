import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from './db.js';
import { createChatServer } from './app.js';

const PORT = Number(process.env.PORT) || 4000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('Missing JWT_SECRET. Copy .env.example to .env and set it.');
  process.exit(1);
}

// If the React app has been built (npm run build in the project root), serve it too
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, '../../client/dist');
const staticDir = fs.existsSync(path.join(clientDist, 'index.html')) ? clientDist : undefined;

const db = createDb(process.env.DATABASE_FILE || 'chat.db');
const { httpServer } = createChatServer({
  db,
  jwtSecret: JWT_SECRET,
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  staticDir,
});

httpServer.listen(PORT, () => {
  console.log(`Chat server running on http://localhost:${PORT}`);
  if (staticDir) console.log('Serving the built React app from client/dist');
});
