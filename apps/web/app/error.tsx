"use client";

import { useEffect } from "react";

import { P5Alert } from "@/components/ui/P5Alert";
import { P5Button } from "@/components/ui/P5Button";
import { P5Card } from "@/components/ui/P5Card";

export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(props.error);
  }, [props.error]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <P5Card
        title="Something went wrong"
        titleAs="h1"
        subtitle="A runtime error occurred."
        actions={[{ href: "/topics", label: "Back to Topics" }]}
      >
        <div className="space-y-3">
          <P5Alert variant="error" title="error" role="alert">
            {props.error.message || "Unknown error"}
          </P5Alert>
          <div className="flex flex-wrap gap-2">
            <P5Button type="button" variant="primary" onClick={() => props.reset()}>
              Try again
            </P5Button>
          </div>
        </div>
      </P5Card>
    </div>
  );
}

