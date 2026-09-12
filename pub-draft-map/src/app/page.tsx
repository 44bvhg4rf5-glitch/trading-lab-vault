import { MapExplorer } from "@/components/MapExplorer";

export default async function Home({ searchParams }: { searchParams: Promise<{ beer?: string; near?: string }> }) {
  const { beer = "", near = "" } = await searchParams;
  return <MapExplorer initialBeer={beer} initialNear={near} />;
}
