import { Router } from 'express';
import { z } from 'zod';
import { requireApiToken } from '../middleware/apiToken';
import { asyncHandler, validateBody, validateParams } from '../middleware/common';
import { rateLimit } from '../middleware/rateLimit';
import {
  createGame,
  importGames,
  gameImportSchema,
  gameSchema,
  gameUpdateSchema,
  updateGame,
} from '../services/playerMutations';

const router = Router();
const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const externalPreAuthLimit = rateLimit({
  name: 'external-games-pre-auth',
  limit: 120,
  windowSeconds: 60,
  failClosed: true,
});
const externalWriteLimit = rateLimit({
  name: 'external-games-write',
  limit: 60,
  windowSeconds: 60,
  key: (req) => `token:${req.apiToken!.id}`,
  failClosed: true,
});

export const externalGameAuth = Router();
externalGameAuth.use(externalPreAuthLimit, requireApiToken);

router.use(externalWriteLimit);

router.post(
  '/games',
  validateBody(gameSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ id: await createGame(req.body) });
  })
);

router.put(
  '/games/:id',
  validateParams(idParamsSchema),
  validateBody(gameUpdateSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamsSchema>;
    await updateGame(id, req.body);
    res.json({ ok: true });
  })
);

router.post(
  '/games/import',
  validateBody(gameImportSchema),
  asyncHandler(async (req, res) => {
    res.json(await importGames(req.body.games));
  })
);

export default router;
