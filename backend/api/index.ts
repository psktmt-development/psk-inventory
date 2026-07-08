// Vercel serverless entry. Vercel routes every request here (see vercel.json);
// the Express app's own /api/* mounts match because `routes` preserves the path.
// Local dev still uses src/server.ts (app.listen); this file is Vercel-only.
import { createApp } from '../src/app.js';

export default createApp();
