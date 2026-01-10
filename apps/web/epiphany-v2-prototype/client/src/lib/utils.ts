import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Strip HTML tags from a string and return plain text
 */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  // Create a temporary element to parse HTML
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent || "";
}
