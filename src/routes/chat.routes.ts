import { Router } from 'express';
import { streamMessage, getHistory } from '../services/chatService';

export const chatRouter = Router();

chatRouter.get('/messages', async (_req, res, next) => {
  try {
    res.json(await getHistory());
  } catch (err) {
    next(err);
  }
});

// Streamed as newline-delimited JSON so the plain-JS frontend can read it with a
// bare `fetch()` + `ReadableStream` reader — no SSE/EventSource (POST body doesn't
// fit EventSource's GET-only model) and no client-side SDK (no build step in this
// PoC, see take-home-tech-spec.md section 2).
// Lines: {"type":"delta","text":"..."} while streaming, then one
// {"type":"done", reply, usedWebSearch, warn}. Errors before the first byte is
// written (budget block, auth, etc.) go through the normal JSON error handler
// instead — see the res.headersSent check below.
chatRouter.post('/messages', async (req, res, next) => {
  try {
    const { content } = req.body;
    res.setHeader('Content-Type', 'application/x-ndjson');
    const result = await streamMessage(content, (delta) => {
      res.write(JSON.stringify({ type: 'delta', text: delta }) + '\n');
    });
    res.write(JSON.stringify({ type: 'done', ...result }) + '\n');
    res.end();
  } catch (err) {
    if (res.headersSent) {
      res.write(JSON.stringify({ type: 'error', error: (err as Error).message }) + '\n');
      res.end();
      return;
    }
    next(err);
  }
});
