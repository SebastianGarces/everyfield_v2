import { z } from "zod";

const paragraph = z.object({
  kind: z.literal("paragraph"),
  text: z.string(),
  heading: z.boolean(),
});
const table = z.object({
  kind: z.literal("table"),
  rows: z.array(z.array(z.string())),
});
export const documentPreviewSchema = z.discriminatedUnion("format", [
  z.object({
    format: z.literal("docx"),
    blocks: z.array(z.union([paragraph, table])),
  }),
  z.object({
    format: z.literal("xlsx"),
    sheets: z.array(
      z.object({
        name: z.string(),
        rows: z.array(
          z.array(
            z.object({
              text: z.string(),
              bold: z.boolean(),
              formula: z.string().nullable(),
            })
          )
        ),
      })
    ),
  }),
]);
export type DocumentPreview = z.infer<typeof documentPreviewSchema>;
export type WordPreviewBlock = Extract<
  DocumentPreview,
  { format: "docx" }
>["blocks"][number];
