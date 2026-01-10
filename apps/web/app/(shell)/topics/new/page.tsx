import { P5Card } from "@/components/ui/P5Card";
import { CreateTopicForm } from "@/components/topics/CreateTopicForm";

export default function NewTopicPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <P5Card
        title="Create topic"
        titleAs="h1"
        subtitle="Create a Topic + Root argument (no signature required)."
        actions={[{ href: "/topics", label: "Back" }]}
      >
        <CreateTopicForm />
      </P5Card>
    </div>
  );
}
