import { z } from "zod";

export const evidenceKinds = ["identity", "face", "age", "phone", "document"] as const;
export type EvidenceKind = typeof evidenceKinds[number];
export const DEFAULT_TTL_DAYS: Readonly<Record<EvidenceKind, number>> = { identity: 365, face: 180, age: 365, phone: 365, document: 365 };
/** Event max_age values are whole seconds, and can only tighten the default TTL. */
export const maxAgeSchema = z.object({
  identity: z.number().int().positive().max(365 * 86400).optional(),
  face: z.number().int().positive().max(180 * 86400).optional(),
  age: z.number().int().positive().max(365 * 86400).optional(),
}).strict();
/** Legacy decoder only. New event policy is checksSchema in event-model.ts. */
export const requirementsSchema = z.object({
  identity: z.boolean().default(true),
  email: z.boolean().default(true),
  liveness: z.boolean().default(true),
  age_min: z.number().int().min(1).max(100).optional(),
}).strict();
export type Requirements = z.infer<typeof requirementsSchema>;
export type MaxAge = z.infer<typeof maxAgeSchema>;
