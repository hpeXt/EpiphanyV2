"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { apiClient } from "@/lib/apiClient";

export function CreateTopicForm() {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<{ title?: string; body?: string }>({});
  const [submitError, setSubmitError] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate(nextTitle: string, nextBody: string) {
    const nextErrors: { title?: string; body?: string } = {};
    if (!nextTitle.trim()) nextErrors.title = "Title is required";
    if (!nextBody.trim()) nextErrors.body = "Body is required";
    return nextErrors;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitError("");

    const nextErrors = validate(title, body);
    setErrors(nextErrors);
    if (nextErrors.title || nextErrors.body) return;

    setIsSubmitting(true);
    const result = await apiClient.createTopic({
      title: title.trim(),
      body: body.trim(),
    });
    setIsSubmitting(false);

    if (!result.ok) {
      setSubmitError(result.error.message);
      return;
    }

    router.push(`/topics/${result.data.topicId}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="title" className="text-sm font-medium">
          Title
        </label>
        <input
          id="title"
          name="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
        />
        {errors.title ? (
          <p role="alert" className="text-sm text-red-700">
            {errors.title}
          </p>
        ) : null}
      </div>

      <div className="space-y-1">
        <label htmlFor="body" className="text-sm font-medium">
          Body
        </label>
        <textarea
          id="body"
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
        />
        {errors.body ? (
          <p role="alert" className="text-sm text-red-700">
            {errors.body}
          </p>
        ) : null}
      </div>

      {submitError ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {submitError}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex items-center justify-center rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {isSubmitting ? "Creating…" : "Create"}
      </button>
    </form>
  );
}
