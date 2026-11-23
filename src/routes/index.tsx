import { createFileRoute } from "@tanstack/react-router";
import { Editor } from "@/components/jiggle/editor";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <Editor />;
}
