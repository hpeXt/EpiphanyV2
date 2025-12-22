import { P5Card } from "@/components/ui/P5Card";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <P5Card
        title="Not Found"
        titleAs="h1"
        subtitle="This page does not exist."
        actions={[{ href: "/topics", label: "Back to Topics" }]}
      >
        <p className="text-sm text-[color:var(--ink)]">
          Check the URL, or go back to the Topics list.
        </p>
      </P5Card>
    </div>
  );
}

