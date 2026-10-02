import { StartupMark } from "@/components/intro/mark";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "development" && (await searchParams)["intro-test"] === "loading") {
    const { LoadingDemo } = await import("@/components/intro/loading-demo");
    return <LoadingDemo />;
  }
  // The landing page is the animated mark and nothing else, in development too:
  // the inspector lives at /dev/intro. When the public site arrives, wrap its page
  // in <StartupBoundary> so the same mark stands in front while it loads.
  return <main id="main-content" className="landing" tabIndex={-1}>
    <h1 className="sr-only">KIASA</h1>
    <StartupMark />
  </main>;
}
