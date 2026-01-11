"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { apiClient } from "@/lib/apiClient";
import { createLocalStorageClaimTokenStore } from "@/lib/claimTokenStore";
import { createLocalStorageTopicAccessKeyStore } from "@/lib/topicAccessKeyStore";
import { P5Alert } from "@/components/ui/P5Alert";
import { P5Button } from "@/components/ui/P5Button";
import { P5Input } from "@/components/ui/P5Input";
import { P5Textarea } from "@/components/ui/P5Textarea";
import { useP5Toast } from "@/components/ui/P5ToastProvider";

export function CreateTopicForm() {
  const router = useRouter();
  const claimStore = useState(() => createLocalStorageClaimTokenStore())[0];
  const { toast } = useP5Toast();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"public" | "unlisted" | "private">("public");
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
      visibility,
    });
    setIsSubmitting(false);

    if (!result.ok) {
      setSubmitError(result.error.message);
      return;
    }

    try {
      claimStore.set(result.data.topicId, {
        claimToken: result.data.claimToken,
        expiresAt: result.data.expiresAt,
      });
    } catch {
      // ignore localStorage errors
    }

    if (result.data.accessKey) {
      try {
        createLocalStorageTopicAccessKeyStore().set(result.data.topicId, result.data.accessKey);
      } catch {
        // ignore localStorage errors
      }
    }

    toast({
      variant: "success",
      title: "created",
      message: "Topic created. Claim token saved locally for 5 minutes.",
    });

    if (result.data.accessKey) {
      router.push(`/topics/${result.data.topicId}#k=${result.data.accessKey}`);
    } else {
      router.push(`/topics/${result.data.topicId}`);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="title" className="font-mono text-xs font-semibold uppercase tracking-wide">
          Title
        </label>
        <P5Input
          id="title"
          name="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {errors.title ? (
          <p role="alert" className="text-sm text-[color:var(--rebel-red)]">
            {errors.title}
          </p>
        ) : null}
      </div>

      <div className="space-y-1">
        <label htmlFor="visibility" className="font-mono text-xs font-semibold uppercase tracking-wide">
          Visibility
        </label>
        <select
          id="visibility"
          name="visibility"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as any)}
          className={[
            "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          ].join(" ")}
        >
          <option value="public">public</option>
          <option value="unlisted">unlisted</option>
          <option value="private">private</option>
        </select>
        <p className="text-xs text-muted-foreground">
          private topics require a link key (#k=…) or prior participation.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="body" className="font-mono text-xs font-semibold uppercase tracking-wide">
          Body
        </label>
        <P5Textarea
          id="body"
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
        />
        {errors.body ? (
          <p role="alert" className="text-sm text-[color:var(--rebel-red)]">
            {errors.body}
          </p>
        ) : null}
      </div>

      {submitError ? (
        <P5Alert variant="error" title="Error">
          {submitError}
        </P5Alert>
      ) : null}

      <P5Button
        type="submit"
        disabled={isSubmitting}
        variant="primary"
      >
        {isSubmitting ? "Creating…" : "Create"}
      </P5Button>
    </form>
  );
}
