import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Kanji Cards Premium" },
      { name: "description", content: "Kanji Cards Premium — kartu belajar kanji interaktif." },
      { property: "og:title", content: "Kanji Cards Premium" },
      { property: "og:description", content: "Kartu belajar kanji interaktif." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <iframe
      src="/kanji.html"
      title="Kanji Cards Premium"
      className="fixed inset-0 h-full w-full border-0"
    />
  );
}
