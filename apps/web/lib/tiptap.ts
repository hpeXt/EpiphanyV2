import type { TiptapDoc } from "@epiphany/shared-contracts";

export function plainTextToTiptapDoc(text: string): TiptapDoc {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  };
}
