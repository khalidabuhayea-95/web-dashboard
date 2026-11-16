#!/usr/bin/env node
// Fetches the ichkil tashkeel model (21 MB) pinned to one Hugging Face commit and checks its
// SHA-256 (src/lib/text/tashkeel/ichkilModel.js). The Dockerfile runs it, so the image never
// downloads at runtime; CI runs it before the tests. Idempotent: a verified file is left alone.
import { ICHKIL_MODEL, ensureIchkilModel } from "../src/lib/text/tashkeel/ichkilModel.js";

const target = await ensureIchkilModel();
console.log(`ichkil ${ICHKIL_MODEL.version} ready at ${target}`);
