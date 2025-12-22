import { P5Card } from "@/components/ui/P5Card";
import { TopicList } from "@/components/topics/TopicList";

export default function TopicsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <P5Card
        title="Topics"
        titleAs="h1"
        subtitle="Pick a topic or start a new one."
        actions={[{ href: "/topics/new", label: "Create topic" }]}
      >
        <TopicList />
      </P5Card>
    </div>
  );
}
