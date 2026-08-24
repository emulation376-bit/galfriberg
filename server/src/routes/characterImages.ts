import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, validateParams } from '../middleware/common';
import { rateLimit } from '../middleware/rateLimit';
import { db } from '../db/knex';
import { fetchCharacterImage, resolveCharacterImage } from '../services/characterImageService';

const router = Router();
const characterParams = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
});

router.get(
  '/character/:id',
  rateLimit({ name: 'image-proxy', limit: 600, windowSeconds: 60 }),
  validateParams(characterParams),
  asyncHandler(async (req, res) => {
    const characterId = req.params.id;
    const character = await db('characters')
      .where({ id: characterId })
      .first('id', 'ymgal_image', 'image');
    if (!character) throw new HttpError(404, 'CHARACTER_NOT_FOUND');

    const candidates = resolveCharacterImage(character);
    if (!candidates.length) throw new HttpError(404, 'IMAGE_NOT_FOUND');

    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        const image = await fetchCharacterImage(characterId, candidate);
        res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
        res.type(image.contentType || 'application/octet-stream');
        res.send(image.buffer);
        return;
      } catch (err) {
        lastError = err;
      }
    }
    console.warn(
      `[image] character ${characterId} fetch failed`,
      lastError instanceof Error ? lastError.message : lastError
    );
    throw new HttpError(502, 'IMAGE_FETCH_FAILED');
  })
);

export default router;
