import { Router } from "express";
import { renderShareCard } from "../controllers/shareController";

const router = Router();

// Deliberately public — no requireAuth. See shareController.ts's top comment
// for why an unauthenticated, unsigned score/name/top% in the URL is fine
// here (it's the sharer's own already-visible data, not anyone else's).
router.get("/:score", renderShareCard);

export default router;
