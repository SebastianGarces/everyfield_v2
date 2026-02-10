import { z } from "zod";

export const loginSchema = z.object({
  email: z.email("Please enter a valid email address"),
  password: z.string().min(1, "Please enter your password"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const accountTypes = ["planter", "sending_church", "network"] as const;
export type AccountType = (typeof accountTypes)[number];

export const registerSchema = z
  .object({
    email: z.email("Please enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    name: z
      .string()
      .transform((v) => v.trim())
      .pipe(z.string().min(1, "Please enter your name")),
    accountType: z.enum(accountTypes).default("planter"),
    organizationName: z
      .string()
      .transform((v) => v.trim())
      .optional(),
  })
  .refine(
    (data) =>
      data.accountType === "planter" ||
      (data.organizationName && data.organizationName.length > 0),
    {
      message: "Please enter a name for your organization",
      path: ["organizationName"],
    }
  );

export type RegisterInput = z.infer<typeof registerSchema>;
