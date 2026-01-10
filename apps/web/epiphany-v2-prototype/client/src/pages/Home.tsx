import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Plus, ArrowRight, Users, MessageSquare } from "lucide-react";
import { getLoginUrl } from "@/const";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

/**
 * Minimalist Homepage following "Invisible Container" design philosophy
 * - Clean, academic journal aesthetic
 * - Focus on content, minimal branding
 * - Direct deep-linking to topics
 */
export default function Home() {
  const { user, isAuthenticated } = useAuth();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTopicTitle, setNewTopicTitle] = useState("");
  const [newTopicDescription, setNewTopicDescription] = useState("");

  const { data: topics, isLoading } = trpc.topic.list.useQuery({ status: "active" });
  const createTopic = trpc.topic.create.useMutation({
    onSuccess: (topic) => {
      setIsCreateOpen(false);
      setNewTopicTitle("");
      setNewTopicDescription("");
      toast.success("Topic created successfully");
      // Navigate to the new topic
      if (topic) {
        window.location.href = `/t/${topic.slug}`;
      }
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleCreateTopic = () => {
    if (!newTopicTitle.trim()) {
      toast.error("Please enter a topic title");
      return;
    }
    createTopic.mutate({
      title: newTopicTitle.trim(),
      description: newTopicDescription.trim() || undefined,
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Minimal Header */}
      <header className="border-b border-border/50">
        <div className="container py-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-serif text-foreground/80">Σ</span>
            <span className="text-sm text-muted-foreground tracking-wide">EPIPHANY</span>
          </div>
          <div className="flex items-center gap-4">
            {isAuthenticated ? (
              <>
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                      <Plus className="h-4 w-4" />
                      New Topic
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle className="font-serif text-xl">Create New Topic</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                      <div>
                        <Input
                          placeholder="Topic title..."
                          value={newTopicTitle}
                          onChange={(e) => setNewTopicTitle(e.target.value)}
                          className="font-serif text-lg"
                        />
                      </div>
                      <div>
                        <Textarea
                          placeholder="Brief description (optional)..."
                          value={newTopicDescription}
                          onChange={(e) => setNewTopicDescription(e.target.value)}
                          rows={3}
                        />
                      </div>
                      <Button 
                        onClick={handleCreateTopic} 
                        className="w-full"
                        disabled={createTopic.isPending}
                      >
                        {createTopic.isPending ? "Creating..." : "Create Topic"}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
                <span className="text-sm text-muted-foreground">{user?.name || "User"}</span>
              </>
            ) : (
              <Button variant="ghost" size="sm" asChild>
                <a href={getLoginUrl()}>Sign In</a>
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-24 md:py-32">
        <div className="container max-w-3xl text-center">
          <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl text-foreground leading-tight mb-6">
            Collective Thinking,
            <br />
            <span className="text-muted-foreground">Visualized</span>
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
            A platform for structured public discourse. Share your thoughts, 
            explore diverse perspectives, and discover collective insights 
            through AI-assisted visualization.
          </p>
        </div>
      </section>

      {/* Topics List */}
      <section className="pb-24">
        <div className="container max-w-4xl">
          <div className="flex items-center justify-between mb-8">
            <h2 className="font-serif text-2xl text-foreground">Active Discussions</h2>
          </div>

          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 bg-muted/50 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : topics && topics.length > 0 ? (
            <div className="space-y-4">
              {topics.map((topic) => (
                <Link key={topic.id} href={`/t/${topic.slug}`}>
                  <article className="group p-6 border border-border/50 rounded-lg hover:border-border hover:bg-muted/30 transition-all cursor-pointer">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-serif text-xl text-foreground group-hover:text-accent transition-colors mb-2">
                          {topic.title}
                        </h3>
                        {topic.description && (
                          <p className="text-muted-foreground text-sm line-clamp-2 mb-4">
                            {topic.description}
                          </p>
                        )}
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            Participants
                          </span>
                          <span className="flex items-center gap-1">
                            <MessageSquare className="h-3 w-3" />
                            Viewpoints
                          </span>
                          <span>
                            {new Date(topic.createdAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </span>
                        </div>
                      </div>
                      <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-accent group-hover:translate-x-1 transition-all flex-shrink-0 mt-1" />
                    </div>
                  </article>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-16 border border-dashed border-border rounded-lg">
              <p className="text-muted-foreground mb-4">No active discussions yet.</p>
              {isAuthenticated ? (
                <Button variant="outline" onClick={() => setIsCreateOpen(true)}>
                  Create the first topic
                </Button>
              ) : (
                <Button variant="outline" asChild>
                  <a href={getLoginUrl()}>Sign in to create a topic</a>
                </Button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8">
        <div className="container text-center">
          <p className="text-xs text-muted-foreground">
            A platform for structured public discourse
          </p>
        </div>
      </footer>
    </div>
  );
}
