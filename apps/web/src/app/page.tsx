import { StartupBoundary } from "@/components/intro/controller";
import { HomePage } from "@/components/site/home";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "development" && (await searchParams)["intro-test"] === "loading") {
    const { LoadingDemo } = await import("@/components/intro/loading-demo");
    return <LoadingDemo />;
  }
  // The homepage, with the animated mark in front of it on every load.
  return <StartupBoundary><HomePage /></StartupBoundary>;
}
