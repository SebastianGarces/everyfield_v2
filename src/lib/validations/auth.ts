import { z } from "zod";
import { userRoles } from "@/db/schema";

export const loginSchema = z.object({
  email: z.email("Please enter a valid email address"),
  password: z.string().min(1, "Please enter your password"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  email: z.email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z
    .string()
    .min(1, "Please enter your name")
    .transform((v) => v.trim()),
  role: z.enum(userRoles).optional().default("planter"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
