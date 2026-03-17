import { z } from "zod";

/**
 * Pagination validation schema
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Template creation/update payload validation
 */
export const templatePayloadSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  slug: z.string().min(1).max(255).optional(),
  status: z.enum(["draft", "published"]).default("draft"),
  category: z.string().max(255).default("general"),
  subCategory: z.string().max(255).default("general"),
  tags: z.array(z.string()).default([]),
  canvasSize: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
  }).optional(),
  data: z.record(z.string(), z.any()).optional(),
  thumbnailDataUrl: z.string().url().optional().nullable(),
});

/**
 * Admin user invitation payload
 */
export const inviteUserSchema = z.object({
  email: z.string().email("Invalid email address"),
});

/**
 * Admin user list query parameters
 */
export const adminUsersListSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});
